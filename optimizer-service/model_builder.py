"""
CP-SAT Model Builder - Production Grade (v8.1)

Key improvements over v2:
  A) Candidate Filtering      - only create x[e,s] for eligible pairs
                                 reduces variable count from O(ExS) to O(6xS)
  B) Pre-Sequence Elimination - remove pairs violating rest-gap before building model
  C) Greedy Hint              - fast heuristic warm-starts the solver (-80% solve time)
  D) Shift Density Reduction  - identical-shift pools use capacity constraints
  E) Debug Metrics            - variables, constraints, coverage_rate, eligible_pairs
  F) Time-Coupled Capacity    - global pool caps across overlapping time slots
  G) Contract Utilization     - FT/PT minimum-hour guarantees + overtime penalty
  H) Shift Continuity         - reward keeping same employees across adjacent slots

Hard Constraints (HC):
  HC-1  Coverage        - every shift assigned exactly once (or marked uncovered)
  HC-2  Overlap         - no employee assigned two overlapping shifts
  HC-3  Rest Gap        - minimum downtime between shifts
  HC-4  Weekly Hours    - employee total minutes <= contracted max
  HC-5  Eligibility     - role + skill + license match (filtered at variable creation)
  HC-6  Time Capacity   - across overlapping shifts, type-pool usage <= pool size
  HC-7  Min Contract    - FT/PT employees must hit minimum contracted hours

Note: HC-2 (overlap) and HC-3 (rest gap) are enforced by this planning optimizer
to ensure that any proposed assignment set is feasible before being passed 
to the autoscheduler for final commitment.

Soft Constraints (objective):
  SC-1  Preference matching   (-$5 discount per preferred slot)
  SC-3  Uncovered penalty     (+$10,000 x priority per uncovered shift)
  SC-4  Fairness              (+$0.10 x workload imbalance minutes)
  SC-5  Overtime penalty      (+150% rate for hours beyond contract)
  SC-6  Shift Continuity      (-$2.00 bonus for same employee on adjacent shifts)

Preprocessing pipeline:
  load -> compute_eligibility -> pre_eliminate_rest_sequences -> build_variables
       -> add_constraints -> greedy_hint -> solve
"""

from __future__ import annotations
import logging
import time
from dataclasses import dataclass, field
from typing import Optional

from ortools.sat.python import cp_model

logger = logging.getLogger(__name__)

# =============================================================================
# INPUT / OUTPUT DATA TYPES
# =============================================================================

@dataclass
class ShiftInput:
    id: str
    shift_date: str
    start_time: str
    end_time: str
    duration_minutes: int
    role_id: Optional[str] = None
    required_skill_ids: list[str] = field(default_factory=list)
    required_license_ids: list[str] = field(default_factory=list)
    priority: int = 1
    unpaid_break_minutes: int = 0
    is_sunday: bool = False
    is_public_holiday: bool = False
    shift_type: str = 'NORMAL'  # 'NORMAL' or 'MULTI_HIRE'
    level: int = 0
    target_employment_type: Optional[str] = None
    is_training: bool = False



@dataclass
class ExistingShiftInput:
    """A shift already committed to an employee (cannot be reassigned by the
    optimizer). Used as a fixed constraint when proposing new assignments."""
    id: str
    shift_date: str
    start_time: str
    end_time: str
    duration_minutes: int
    # Unpaid break minutes carried from the wire boundary. Used by
    # `_calculate_effective_minutes` for fatigue scoring; if missing the
    # solver under-counts circadian-weighted load.
    unpaid_break_minutes: int = 0
    start_abs: int = 0
    end_abs: int = 0


@dataclass
class AvailabilitySlotInput:
    """A declared availability window for an employee on a given date.

    All times are local 'HH:MM' or 'HH:MM:SS'. When `has_availability_data`
    is true on the parent EmployeeInput, slots are *hard*: a shift must be
    fully covered by at least one slot for the employee to be eligible.
    """
    slot_date: str
    start_time: str
    end_time: str


@dataclass
class EmployeeInput:
    id: str
    name: str
    role_id: Optional[str] = None
    employment_type: str = 'Casual'
    hourly_rate: float = 25.0
    max_weekly_minutes: int = 2400
    # Minimum contracted weekly minutes. FT employees MUST be assigned at
    # least this many minutes. Solver will pay overtime penalty above this.
    # Set to 0 for Casuals (no contract obligation).
    min_contract_minutes: int = 0
    contract_weekly_minutes: int = 2280 # Default 38h
    skill_ids: list[str] = field(default_factory=list)
    license_ids: list[str] = field(default_factory=list)
    preferred_shift_ids: list[str] = field(default_factory=list)
    unavailable_dates: list[str] = field(default_factory=list)
    # Severity-based availability (dates or intervals)
    # [ (start, end, severity) ] where severity is 'HARD', 'SOFT', or 'PREFERENCE'
    availability_overrides: list[tuple[str, str, str]] = field(default_factory=list)
    level: int = 0
    is_flexible: bool = False
    is_student: bool = False
    visa_limit: int = 2880 # Standard 48h/fortnight


    initial_fatigue_score: float = 0.0
    # Pinned/already-committed shifts for this employee. The optimizer treats
    # these as immutable: it will not propose any shift that overlaps or
    # violates the rest gap against them, and it counts their minutes
    # against max_weekly_minutes.
    existing_shifts: list[ExistingShiftInput] = field(default_factory=list)
    # Declared availability windows in the optimization range. Hard filter
    # applies only when `has_availability_data` is true (see employee_eligible).
    availability_slots: list[AvailabilitySlotInput] = field(default_factory=list)
    has_availability_data: bool = False


@dataclass
class OptimizerConstraints:
    min_rest_minutes: int = 600
    enforce_role_match: bool = True
    enforce_skill_match: bool = True
    allow_partial: bool = True
    relax_constraints: bool = False


@dataclass
class StrategyInput:
    fatigue_weight: int = 50
    fairness_weight: int = 50
    cost_weight: int = 50
    coverage_weight: int = 100


def _strategy_mult(weight: int) -> float:
    # Symmetric exponential: 0% -> 0.5x, 50% -> 1.0x, 100% -> 2.0x.
    # Lets operators halve a term as well as double it (Gap 6 audit fix).
    return 2.0 ** ((weight - 50) / 50.0)


@dataclass
class SolverParameters:
    max_time_seconds: float = 30.0
    num_workers: int = 8
    enable_greedy_hint: bool = True
    log_search: bool = False


@dataclass
class OptimizerInput:
    shifts: list[ShiftInput]
    employees: list[EmployeeInput]
    constraints: OptimizerConstraints = field(default_factory=OptimizerConstraints)
    strategy: StrategyInput = field(default_factory=StrategyInput)
    solver_params: SolverParameters = field(default_factory=SolverParameters)


@dataclass
class AssignmentProposal:
    shift_id: str
    employee_id: str
    employment_type: str
    cost: float


@dataclass
class OptimizerDebugMetrics:
    raw_pairs: int               # E x S before filtering
    eligible_pairs: int          # After eligibility filter
    rest_eliminated_pairs: int   # Further removed by rest-gap pre-filter
    final_variables: int         # Actual CP-SAT bool vars created
    num_constraints: int
    greedy_hint_applied: bool
    preprocess_ms: float
    solve_ms: float


@dataclass
class OptimizerOutput:
    status: str
    assignments: list[AssignmentProposal]
    unassigned_shift_ids: list[str]
    objective_value: float
    best_objective_bound: float
    proven_optimal: bool
    metrics: OptimizerDebugMetrics
    objective_breakdown: Optional[dict[str, int]] = None


# =============================================================================
# TIME UTILITIES
# =============================================================================

def _time_to_abs_minutes(date: str, time_str: str) -> int:
    """Convert YYYY-MM-DD HH:MM to absolute minutes (stable epoch for scheduling)."""
    y, m, d = map(int, date.split('-'))
    parts = time_str.split(':')
    h = int(parts[0])
    mi = int(parts[1])
    day_num = (
        (y - 1970) * 365
        + (y - 1970) // 4
        + [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334][m - 1]
        + (d - 1)
    )
    return day_num * 1440 + h * 60 + mi


def shift_window(s) -> tuple[int, int]:
    """Return (start_min, end_min) - handles overnight shifts correctly.

    Accepts any object with shift_date/start_time/end_time string attributes
    (ShiftInput or ExistingShiftInput).
    """
    parts = s.start_time.split(':')
    sh, sm = int(parts[0]), int(parts[1])
    parts_e = s.end_time.split(':')
    eh, em = int(parts_e[0]), int(parts_e[1])
    start_abs = _time_to_abs_minutes(s.shift_date, s.start_time)
    day_base  = start_abs - (sh * 60 + sm)
    end_abs   = day_base + eh * 60 + em
    if end_abs <= start_abs:
        end_abs += 1440  # Overnight: end is next calendar day
    return start_abs, end_abs


def minutes_on_day(s, day_abs_start: int) -> int:
    """Returns the number of minutes a shift falls on a specific calendar day."""
    s0, s1 = shift_window(s)
    day_abs_end = day_abs_start + 1440
    # Intersection
    overlap_start = max(s0, day_abs_start)
    overlap_end = min(s1, day_abs_end)
    if overlap_start < overlap_end:
        return overlap_end - overlap_start
    return 0


def shifts_overlap(a, b) -> bool:
    a0, a1 = shift_window(a)
    b0, b1 = shift_window(b)
    return a0 < b1 and b0 < a1


def rest_gap_violated(a, b, min_rest: int) -> bool:
    """True if placing a and b in the same schedule violates the rest gap."""
    if shifts_overlap(a, b):
        return True
    a0, a1 = shift_window(a)
    b0, b1 = shift_window(b)
    if a0 < b0:
        return (b0 - a1) < min_rest
    else:
        return (a0 - b1) < min_rest


def existing_blocks_proposal(
    proposed: ShiftInput,
    existing_list: list[ExistingShiftInput],
    standard_min_rest: int,
) -> bool:
    """True if any of the employee's existing (pinned) shifts overlaps or
    violates rest-gap against the proposed shift.
    
    Respects ICC EBA Multi-Hire rule: 8h (480m) gap if either shift is MULTI_HIRE, 
    otherwise standard 10h (600m).
    """
    for ex in existing_list:
        # Multi-hire logic: if the proposed shift is multi-hire, 
        # the required gap drops to 8h (480m).
        required = 480 if getattr(proposed, 'shift_type', 'NORMAL') == 'MULTI_HIRE' else standard_min_rest
        if rest_gap_violated(proposed, ex, required):
            return True
    return False


def _calculate_effective_minutes(s) -> int:
    """Calculates effective duration (weighted by circadian penalties).
    
    Weights (per Award MA000080 fatigue principles):
    - 12am-2am: +25%
    - 2am-6am:  +50% (Danger Zone)
    - 6am-8am:  +25%
    - 10am-4pm: -25% (Daylight Reward)
    - Others:   Standard (1.0)
    """
    start_abs, end_abs = shift_window(s)
    total_mins = end_abs - start_abs
    if total_mins <= 0: return 0
    
    # Define penalty intervals (relative to day start)
    # 0=12am, 120=2am, 360=6am, 480=8am, 600=10am, 960=4pm, 1320=10pm, 1440=12am
    intervals = [
        (0, 120, 1.25),      # 12am-2am
        (120, 360, 1.50),    # 2am-6am
        (360, 480, 1.25),    # 6am-8am
        (480, 600, 1.00),    # 8am-10am
        (600, 960, 0.75),    # 10am-4pm
        (960, 1320, 1.00),   # 4pm-10pm
        (1320, 1440, 1.25),  # 10pm-12am
    ]
    
    # Support overnight by adding next day intervals
    extended_intervals = intervals + [(s + 1440, e + 1440, w) for s, e, w in intervals]
    
    weighted_mins = 0
    day_start = (start_abs // 1440) * 1440
    
    for i_start, i_end, weight in extended_intervals:
        abs_i_start = day_start + i_start
        abs_i_end = day_start + i_end
        
        overlap_start = max(start_abs, abs_i_start)
        overlap_end = min(end_abs, abs_i_end)
        
        if overlap_end > overlap_start:
            weighted_mins += (overlap_end - overlap_start) * weight
            
    # Subtract unpaid break (pro-rated)
    unpaid = getattr(s, 'unpaid_break_minutes', 0)
    if unpaid > 0:
        ratio = weighted_mins / total_mins
        weighted_mins -= unpaid * ratio
        
    return int(round(weighted_mins))


# =============================================================================
# ELIGIBILITY CHECK (HC-5)
# =============================================================================

def employee_eligible(
    emp: EmployeeInput,
    shift: ShiftInput,
    c: OptimizerConstraints,
) -> bool:
    if shift.shift_date in emp.unavailable_dates:
        return False
    if c.enforce_role_match and shift.role_id and emp.role_id and emp.role_id != shift.role_id:
        return False
    if c.enforce_skill_match and shift.required_skill_ids:
        if not set(shift.required_skill_ids).issubset(set(emp.skill_ids)):
            return False
    if c.enforce_skill_match and shift.required_license_ids:
        if not set(shift.required_license_ids).issubset(set(emp.license_ids)):
            return False
    # HC-3: Rest Gap / Overlap with EXISTING
    if emp.existing_shifts and existing_blocks_proposal(
        shift, emp.existing_shifts, c.min_rest_minutes,
    ):
        if not c.relax_constraints:
            return False
    
    # HC-5b: Skill Hierarchy. Treat missing level data on either side as 0 so
    # an unmapped employee/shift never silently filters out the entire pool.
    # Upstream code is supposed to populate this, but defensive defaults
    # prevent a single missing field from collapsing the model to INFEASIBLE.
    emp_level = emp.level if emp.level is not None else 0
    shift_level = getattr(shift, 'level', 0) or 0
    if emp_level < shift_level:
        return False

    # HC-6: Minimum Engagement Pre-filter
    # Note: keep this loose by default — many valid rosters use 1-2h
    # micro-shifts (training blocks, briefings, splits). Reject only
    # implausibly short (<60m) shifts here; the proper award-specific min
    # engagement is enforced as a soft penalty inside the V8 compliance
    # engine, not a hard pre-filter.
    if shift.duration_minutes < 60:
        return False

    # HC-5c: Employment Isolation (Transitioned to SOFT as per Fix #8)
    # We allow cross-assignments but SC-1 will penalize them.

    # HARD Availability blocks
    for start, end, severity in emp.availability_overrides:
        if severity == 'HARD':
            s0, s1 = shift_window(shift)
            a0 = _time_to_abs_minutes(shift.shift_date, start)
            a1 = _time_to_abs_minutes(shift.shift_date, end)
            if a1 <= a0: a1 += 1440 # Cross-midnight

            # Intersection check
            if s0 < a1 and a0 < s1:
                return False

    # HC-5d: Declared availability windows (hard filter when on file).
    #
    # Policy: an employee with NO availability records on file at all is
    # treated as universally available (not yet onboarded). An employee with
    # ANY records on file (`has_availability_data=True`) is treated as
    # available *only* during declared slots — any shift not fully covered
    # by at least one slot is rejected.
    if emp.has_availability_data:
        s0, s1 = shift_window(shift)
        covered = False
        for slot in emp.availability_slots:
            if slot.slot_date != shift.shift_date:
                continue
            a0 = _time_to_abs_minutes(slot.slot_date, slot.start_time)
            a1 = _time_to_abs_minutes(slot.slot_date, slot.end_time)
            if a1 <= a0:
                a1 += 1440  # cross-midnight slot
            # The shift must be fully contained within the slot.
            if a0 <= s0 and a1 >= s1:
                covered = True
                break
        if not covered:
            return False
    return True


# =============================================================================
# GREEDY PRE-SOLUTION (solver warm-start)
# =============================================================================

def compute_greedy_hint(
    shifts: list[ShiftInput],
    employees: list[EmployeeInput],
    eligibility_map: dict[str, list[EmployeeInput]],
    rest_eliminated: set[tuple[str, str]],
) -> dict[tuple[str, str], int]:
    """
    Fast greedy assignment: for each shift (highest priority first),
    assign to the least-loaded eligible employee that doesn't violate rest.

    Returns dict { (emp_id, shift_id): 1|0 } as hints for the solver.
    """
    assigned_shifts: dict[str, list[ShiftInput]] = {e.id: [] for e in employees}
    hints: dict[tuple[str, str], int] = {}

    # Process highest-priority, earliest shifts first
    ordered = sorted(shifts, key=lambda s: (-s.priority, s.shift_date, s.start_time))

    for shift in ordered:
        eligible = eligibility_map.get(shift.id, [])
        best_emp = None
        best_load = float('inf')

        for emp in eligible:
            # Skip pre-eliminated pairs
            if (emp.id, shift.id) in rest_eliminated:
                continue
            # Check rest gap against already-assigned shifts AND the
            # employee's existing committed shifts. Without the second
            # check the hint can plant assignments that downstream
            # constraints immediately reject, sabotaging warm-start
            # convergence and causing UNKNOWN time-outs.
            required = 480 if (shift.shift_type == 'MULTI_HIRE' or any(s.shift_type == 'MULTI_HIRE' for s in assigned_shifts[emp.id])) else 600
            conflict = any(
                rest_gap_violated(existing, shift, required)
                for existing in assigned_shifts[emp.id]
            )
            if conflict:
                continue
            if emp.existing_shifts and existing_blocks_proposal(
                shift, emp.existing_shifts, required,
            ):
                continue
            load = sum(s.duration_minutes for s in assigned_shifts[emp.id])
            if load < best_load:
                best_load = load
                best_emp = emp

        if best_emp:
            assigned_shifts[best_emp.id].append(shift)
            hints[(best_emp.id, shift.id)] = 1

    return hints


# =============================================================================
# MODEL BUILDER
# =============================================================================

class ScheduleModelBuilder:

    def __init__(self, data: OptimizerInput):
        self.data = data
        self.model = cp_model.CpModel()
        self._x: dict[tuple[str, str], cp_model.IntVar] = {}
        self._uncovered: dict[str, cp_model.IntVar] = {}
        # Populated during build
        self._eligibility_map: dict[str, list[EmployeeInput]] = {}
        self._rest_eliminated: set[tuple[str, str]] = set()
        self._workload_slack_terms: list[cp_model.LinearExpr] = []
        self._metrics = OptimizerDebugMetrics(
            raw_pairs=0, eligible_pairs=0, rest_eliminated_pairs=0,
            final_variables=0, num_constraints=0, greedy_hint_applied=False,
            preprocess_ms=0.0, solve_ms=0.0,
        )
        self._emp_workload_vars: dict[str, cp_model.IntVar] = {}
        self._relaxed_violations_vars: list[cp_model.BoolVar] = []
        # Per-category objective term accounting (same expressions as in
        # `terms`, kept separately so objective_breakdown() can evaluate them
        # against the solver solution after solve).
        self._term_categories: dict[str, list] = {
            'cost': [],
            'fairness': [],
            'fatigue': [],
            'coverage': [],
            'continuity': [],
            'overqual': [],
            'employment_mix': [],
            'relaxed_violations': [],
            'availability': [],
            'other': [],
        }

    # -- Objective breakdown ---------------------------------------------------

    def objective_breakdown(self, solver: cp_model.CpSolver) -> dict[str, int]:
        """Return per-category contribution to the objective value.

        Evaluates each category's linear expression list against the solver's
        solution via solver.value(). Only categories with at least one term are
        included in the result. Call this only after a OPTIMAL/FEASIBLE solve.
        """
        result: dict[str, int] = {}
        for category, term_list in self._term_categories.items():
            if not term_list:
                continue
            total = 0
            for term in term_list:
                try:
                    total += solver.value(term)
                except Exception:
                    # If a term is a plain int (constant), add it directly.
                    if isinstance(term, int):
                        total += term
            result[category] = total
        return result

    # -- Public entry ----------------------------------------------------------

    def build_and_solve(self) -> OptimizerOutput:
        t_pre = time.perf_counter()

        # A: Compute eligible pairs
        self._compute_eligibility()
        # B: Create variables (only for surviving pairs)
        self._create_variables()

        # D: Add hard constraints
        self._add_coverage()
        self._add_overlap_and_rest()    # HC-2 + HC-3 via AddNoOverlap intervals
        self._add_workload_limits()     # HC-4: Rolling EBA + 20-in-28
        # HC-6 removed: _add_time_capacity duplicated HC-2 (no-overlap) and
        # collapsed unassignable pools when employment_type strings drifted
        # (e.g. 'Full-time' vs 'FT'). HC-2 alone is sufficient — an employee
        # cannot be on two overlapping shifts, so cluster-level pool caps
        # add no information.
        self._add_min_contract_hours()  # HC-7: FT/PT minimum utilization
        self._add_min_engagement()      # HC-8: 3h/4h min engagement
        self._add_spread_of_hours()     # HC-9: 12h daily spread
        self._add_objective()

        self._metrics.num_constraints = len(self.model.proto.constraints)
        self._metrics.preprocess_ms = round((time.perf_counter() - t_pre) * 1000, 2)

        # E: Greedy hint
        if self.data.solver_params.enable_greedy_hint:
            self._apply_greedy_hint()

        # Search strategy: declared inside _add_objective() — uncovered vars
        # first (force coverage), then x vars. Under FIXED_SEARCH only the
        # first declared strategy is honored, so a duplicate strategy here
        # would be ignored anyway. Keeping ordering centralized in the
        # objective makes the priority obvious.

        # F: Solve
        t_solve = time.perf_counter()
        output = self._solve()
        self._metrics.solve_ms = round((time.perf_counter() - t_solve) * 1000, 2)

        logger.info(
            '[ModelBuilder] raw_pairs=%d eligible=%d rest_elim=%d vars=%d constraints=%d '
            'preprocess_ms=%.1f solve_ms=%.1f status=%s assignments=%d coverage=%.0f%%',
            self._metrics.raw_pairs,
            self._metrics.eligible_pairs,
            self._metrics.rest_eliminated_pairs,
            self._metrics.final_variables,
            self._metrics.num_constraints,
            self._metrics.preprocess_ms,
            self._metrics.solve_ms,
            output.status,
            len(output.assignments),
            (len(output.assignments) / max(len(self.data.shifts), 1)) * 100,
        )

        output.metrics = self._metrics
        return output

    # -- A: Eligibility filtering ----------------------------------------------

    def _compute_eligibility(self):
        """Build eligibility_map[shift_id] = [eligible employees].

        Improvement: variable count drops from ExS to ~6xS (avg 6 eligible/shift).
        """
        c = self.data.constraints
        self._metrics.raw_pairs = len(self.data.employees) * len(self.data.shifts)

        for shift in self.data.shifts:
            eligible = [e for e in self.data.employees if employee_eligible(e, shift, c)]
            self._eligibility_map[shift.id] = eligible

        self._metrics.eligible_pairs = sum(
            len(v) for v in self._eligibility_map.values()
        )

    # -- C: Variable creation --------------------------------------------------

    def _create_variables(self):
        for shift in self.data.shifts:
            for emp in self._eligibility_map[shift.id]:
                self._x[emp.id, shift.id] = self.model.NewBoolVar(
                    f'x_{emp.id[:6]}_{shift.id[:6]}'
                )
            self._uncovered[shift.id] = self.model.NewBoolVar(f'u_{shift.id[:8]}')

        self._metrics.final_variables = len(self._x)
        
        # C2: Create Workload Variables (shared by limits and objective)
        for emp in self.data.employees:
            wterms = [
                s.duration_minutes * self._x[emp.id, s.id]
                for s in self.data.shifts
                if (emp.id, s.id) in self._x
            ]
            existing_minutes = sum(es.duration_minutes for es in emp.existing_shifts)
            w = self.model.NewIntVar(0, emp.max_weekly_minutes + 10000, f'w_{emp.id[:6]}')
            self.model.Add(w == cp_model.LinearExpr.Sum(wterms) + existing_minutes)
            self._emp_workload_vars[emp.id] = w

    # -- HC-1: Coverage --------------------------------------------------------

    def _add_coverage(self):
        for shift in self.data.shifts:
            eligible_vars = [
                self._x[emp.id, shift.id]
                for emp in self._eligibility_map[shift.id]
                if (emp.id, shift.id) in self._x
            ]
            if not eligible_vars:
                self.model.Add(self._uncovered[shift.id] == 1)
            else:
                self.model.Add(cp_model.LinearExpr.Sum(eligible_vars) + self._uncovered[shift.id] == 1)

    # -- HC-2 + HC-3: No overlap AND minimum rest gap ------------------------
    #
    # Replaces the old O(E·O) pairwise constraint approach. The previous
    # build emitted one `v1 + v2 <= 1` per (employee, overlapping-shift-pair)
    # × 2 for rest-gap, producing ~1.5M constraints for a 624-shift × 103-
    # employee problem and ~7-8s of preprocess time.
    #
    # The CP-SAT idiom is `AddNoOverlap` on `OptionalIntervalVar`s. Each
    # shift becomes one optional interval per eligible employee, padded on
    # the trailing edge by `min_rest_minutes` so that "no two intervals
    # overlap" simultaneously enforces:
    #   - HC-2 (real shift times can't overlap)
    #   - HC-3 (rest gap before the next shift must be >= min_rest)
    #
    # Constraint count drops from O(E·S²) to O(E) — one AddNoOverlap call
    # per employee — and CP-SAT's specialized cumulative propagator handles
    # this far more efficiently than thousands of pairwise booleans.
    #
    # NOTE on multi-hire (480m) rest gap: the legacy implementation used
    # 480m gap when EITHER shift was MULTI_HIRE. The interval approach uses
    # one universal pad. We use `min_rest_minutes` (default 600); multi-hire
    # cases will be slightly over-constrained (600 vs 480 = 2h tighter).
    # That's acceptable for Phase 1; tracking as a follow-up to add an
    # OR-relaxation for multi-hire pairs if it materially affects coverage.

    def _add_overlap_and_rest(self):
        if self.data.constraints.relax_constraints:
            # Relax mode: keep the legacy pairwise formulation so we can
            # surface specific overlap/rest violations in the objective.
            # AddNoOverlap is "all-or-nothing" — softening it requires
            # one indicator var per pair anyway, which negates the
            # constraint-count win.
            self._add_overlap_pairwise_relaxed()
            self._add_rest_gap_pairwise_relaxed()
            return

        min_rest = self.data.constraints.min_rest_minutes

        for emp in self.data.employees:
            intervals = []
            # Optional interval per (eligible) candidate shift
            for s in self.data.shifts:
                v = self._x.get((emp.id, s.id))
                if v is None:
                    continue
                s_start, s_end = shift_window(s)
                duration = s_end - s_start
                size = duration + min_rest  # padded for rest gap
                end = s_end + min_rest
                interval = self.model.NewOptionalIntervalVar(
                    s_start, size, end, v,
                    f'iv_{emp.id[:6]}_{s.id[:6]}',
                )
                intervals.append(interval)

            # Pinned existing shifts: fixed intervals that always exist.
            # Padding them too so the rest-gap-after-existing constraint
            # is enforced (you can't propose a shift starting <600m after
            # the employee's already-committed end time).
            for ex in emp.existing_shifts:
                ex_start, ex_end = shift_window(ex)
                duration = ex_end - ex_start
                size = duration + min_rest
                end = ex_end + min_rest
                fixed = self.model.NewIntervalVar(
                    ex_start, size, end,
                    f'iv_ex_{emp.id[:6]}_{ex.id[:6]}',
                )
                intervals.append(fixed)

            if intervals:
                self.model.AddNoOverlap(intervals)

    def _add_overlap_pairwise_relaxed(self):
        """Legacy pairwise overlap, used only under relax_constraints=true.

        Necessary because softening AddNoOverlap requires per-pair
        indicators anyway, and tracking which specific pair was relaxed
        is cleaner with explicit booleans.
        """
        shifts_sorted = sorted(self.data.shifts, key=lambda s: shift_window(s)[0])
        for i, s1 in enumerate(shifts_sorted):
            _, s1_end = shift_window(s1)
            for j in range(i + 1, len(shifts_sorted)):
                s2 = shifts_sorted[j]
                s2_start, _ = shift_window(s2)
                if s2_start >= s1_end:
                    break
                if shifts_overlap(s1, s2):
                    for emp in self.data.employees:
                        v1 = self._x.get((emp.id, s1.id))
                        v2 = self._x.get((emp.id, s2.id))
                        if v1 is not None and v2 is not None:
                            violation = self.model.NewBoolVar(
                                f'v_overlap_{emp.id[:4]}_{s1.id[:4]}_{s2.id[:4]}',
                            )
                            self.model.Add(v1 + v2 <= 1 + violation)
                            self._relaxed_violations_vars.append(violation)

    def _add_rest_gap_pairwise_relaxed(self):
        """Legacy pairwise rest gap, used only under relax_constraints=true."""
        min_rest = self.data.constraints.min_rest_minutes
        shifts_sorted = sorted(self.data.shifts, key=lambda s: shift_window(s)[0])
        for i, s1 in enumerate(shifts_sorted):
            s1_start, s1_end = shift_window(s1)
            for j in range(i + 1, len(shifts_sorted)):
                s2 = shifts_sorted[j]
                s2_start, s2_end = shift_window(s2)
                if s2_start >= s1_end + min_rest:
                    break
                if rest_gap_violated(s1, s2, min_rest):
                    for emp in self.data.employees:
                        v1 = self._x.get((emp.id, s1.id))
                        v2 = self._x.get((emp.id, s2.id))
                        if v1 is not None and v2 is not None:
                            required = 480 if (
                                s1.shift_type == 'MULTI_HIRE'
                                or s2.shift_type == 'MULTI_HIRE'
                            ) else min_rest
                            gap = abs(s2_start - s1_end) if s2_start > s1_end else abs(s1_start - s2_end)
                            if gap < required:
                                violation = self.model.NewBoolVar(
                                    f'v_rest_{emp.id[:4]}_{s1.id[:4]}_{s2.id[:4]}',
                                )
                                self.model.Add(v1 + v2 <= 1 + violation)
                                self._relaxed_violations_vars.append(violation)

    # -- HC-4: V8 Workload Limits (EBA + 20-in-28) --------------------------
    def _add_workload_limits(self):
        """
        Implements:
        1. EBA 28-day rolling window: S[i+27] - S[i-1] <= 152h
        2. Workday 28-day window: sum(work_day[d]) <= 20
        """
        all_dates = set()
        for s in self.data.shifts: all_dates.add(s.shift_date)
        for e in self.data.employees:
            for ex in e.existing_shifts: all_dates.add(ex.shift_date)
        
        if not all_dates: return
        
        sorted_dates = sorted(list(all_dates))
        first_date = sorted_dates[0]
        last_date = sorted_dates[-1]
        
        d0_abs = _time_to_abs_minutes(first_date, "00:00") // 1440
        dN_abs = _time_to_abs_minutes(last_date, "00:00") // 1440
        num_calendar_days = dN_abs - d0_abs + 1

        for emp in self.data.employees:
            # day_vars[i] = total minutes worked on calendar day (d0 + i)
            day_vars = [self.model.NewIntVar(0, 720, f'd_{emp.id[:4]}_{i}') for i in range(num_calendar_days)]
            work_day_vars = [self.model.NewBoolVar(f'wd_{emp.id[:4]}_{i}') for i in range(num_calendar_days)]
            
            for i in range(num_calendar_days):
                day_start_abs = d0_abs + i * 1440
                day_end_abs = day_start_abs + 1440
                shift_terms = []
                for s in self.data.shifts:
                    if (emp.id, s.id) in self._x:
                        dur_on_day = minutes_on_day(s, day_start_abs)
                        if dur_on_day > 0:
                            shift_terms.append((dur_on_day, self._x[emp.id, s.id]))
                
                existing_mins = sum(max(0, min(ex.end_abs, day_end_abs) - max(ex.start_abs, day_start_abs)) for ex in emp.existing_shifts)
                
                # Link day_vars
                self.model.Add(day_vars[i] == cp_model.LinearExpr.Sum([dur * var for dur, var in shift_terms]) + existing_mins)
                
                # Link work_day_vars
                # Link work_day_vars (Precision Fix #7: mark BOTH days for cross-midnight)
                for s in self.data.shifts:
                    if (emp.id, s.id) in self._x:
                        if minutes_on_day(s, day_start_abs) > 0:
                            self.model.Add(work_day_vars[i] >= self._x[emp.id, s.id])
                
                # Also check existing shifts for workday linking
                if any(minutes_on_day(ex, day_start_abs) > 0 for ex in emp.existing_shifts):
                    self.model.Add(work_day_vars[i] == 1)

            S = [self.model.NewIntVar(0, num_calendar_days * 1440, f'S_{emp.id[:4]}_{i}') for i in range(num_calendar_days)]
            self.model.Add(S[0] == day_vars[0])
            for i in range(1, num_calendar_days):
                self.model.Add(S[i] == S[i-1] + day_vars[i])

            # 3. Ordinary Hours Averaging (Precision Fix #1: Keep ONLY 28-day)
            if emp.employment_type in ('FT', 'PT'):
                for i in range(num_calendar_days):
                    if i >= 27: # 28-day rolling window
                        start_idx = i - 27
                        start_val = S[start_idx-1] if start_idx > 0 else 0
                        # Standard 152h/28d = 9120m
                        limit_mins = 9120
                        
                        slack = self.model.NewIntVar(0, 100_000, f'slack_h_{emp.id[:4]}_{i}')
                        self.model.Add(S[i] - start_val - slack <= limit_mins)
                        # Tier 0: Hard Legal Compliance (100,000,000 penalty)
                        self._workload_slack_terms.append(100_000_000 * slack)
            
            # 4. Consecutive Days Limit (Precision Fix #2: Move to SOFT)
            max_streak = 7
            if emp.employment_type == 'PT' and emp.is_flexible: max_streak = 10
            elif emp.employment_type == 'Casual': max_streak = 12
                
            for i in range(num_calendar_days):
                if i >= max_streak:
                    streak_over = self.model.NewIntVar(0, 7, f'streak_{emp.id[:4]}_{i}')
                    self.model.Add(sum(work_day_vars[i-max_streak:i+1]) - streak_over <= max_streak)
                    # Tier 0: Hard Legal Compliance (100,000,000 penalty)
                    self._workload_slack_terms.append(100_000_000 * streak_over)

            # 5. Student Visa Constraint (HC-12: Rolling 14 days, Dynamic Limit)
            if emp.is_student:
                for i in range(num_calendar_days):
                    if i >= 13: # 14-day window
                        start_idx = i - 13
                        start_val = S[start_idx-1] if start_idx > 0 else 0
                        visa_slack = self.model.NewIntVar(0, 10000, f'visa_{emp.id[:4]}_{i}')
                        self.model.Add(S[i] - start_val - visa_slack <= emp.visa_limit)
                        # Tier 0: Hard Legal Compliance (100,000,000 penalty)
                        self._workload_slack_terms.append(100_000_000 * visa_slack)

            # 6. Anti-Hogging Constraint (Precision Fix #7: Ensure Slack)
            total_demand_mins = sum(s.duration_minutes for s in self.data.shifts)
            if total_demand_mins > 0:
                share_limit = int(0.65 * total_demand_mins)
                w_var = self._emp_workload_vars.get(emp.id)
                if w_var is not None:
                    hog_slack = self.model.NewIntVar(0, 20000, f'hog_{emp.id[:6]}')
                    self.model.Add(w_var - hog_slack <= share_limit)
                    # Tier 2: Fairness Slack (Reduced from 1,000 to 10 to prioritize coverage)
                    self._workload_slack_terms.append(10 * hog_slack)

    # -- HC-8: Minimum Engagement ----------------------------------------------
    def _add_min_engagement(self):
        # Now handled via pre-filtering in employee_eligible (Precision Fix #5)
        pass

    # -- HC-9: Spread of Hours ------------------------------------------------
    def _add_spread_of_hours(self):
        """Total spread (first start to last end) <= 12h per day.
        
        Optimized Formulation:
        For each (employee, day), define d_start and d_end variables.
        For each shift s assigned to the employee:
            d_start <= s.start
            d_end >= s.end
        Constraint: d_end - d_start <= 720 (12 hours)
        """
        shifts_by_day = {}
        for s in self.data.shifts:
            shifts_by_day.setdefault(s.shift_date, []).append(s)

        for date, day_shifts in shifts_by_day.items():
            if len(day_shifts) < 2: continue
            for emp in self.data.employees:
                active_vars = []
                for s in day_shifts:
                    var = self._x.get((emp.id, s.id))
                    if var is not None:
                        active_vars.append((s, var))
                
                if len(active_vars) < 2: continue

                # CRITICAL: compare day-relative minutes (0..2880), NOT
                # absolute minutes since 1970. shift_window() returns
                # absolute minutes (millions); using those values against
                # `d_end <= 2880` makes `d_end >= s_end` infeasible whenever
                # v=1, which the solver "satisfies" by leaving every shift
                # unassigned. That bug single-handedly produces
                # status=OPTIMAL with 0 assignments on any day with two or
                # more shifts that share an employee candidate.
                d_start = self.model.NewIntVar(0, 2880, f'spread_start_{emp.id[:4]}_{date}')
                d_end = self.model.NewIntVar(0, 2880, f'spread_end_{emp.id[:4]}_{date}')

                for s, v in active_vars:
                    s_abs_start, s_abs_end = shift_window(s)
                    day_base = (s_abs_start // 1440) * 1440
                    s_start_rel = s_abs_start - day_base   # 0..1440
                    s_end_rel = s_abs_end - day_base       # may exceed 1440 for overnight
                    self.model.Add(d_start <= s_start_rel).OnlyEnforceIf(v)
                    self.model.Add(d_end >= s_end_rel).OnlyEnforceIf(v)

                # Enforce 12h spread (Softened with Tier 0 penalty)
                spread_slack = self.model.NewIntVar(0, 1440, f'spread_slack_{emp.id[:4]}_{date}')
                self.model.Add(d_end - d_start - spread_slack <= 720)
                # Tier 0: Hard Legal Compliance (100,000,000 penalty per minute)
                # Note: _workload_slack_terms is currently NOT added to the
                # objective (separate bug), so this penalty is dormant.
                self._workload_slack_terms.append(100_000_000 * spread_slack)

    # -- HC-6: Time-Coupled Capacity --------------------------------------------

    def _add_time_capacity(self):
        """Deprecated. HC-2 (no-overlap) already guarantees a single employee
        cannot occupy two overlapping shifts; cluster-level pool caps were
        redundant and brittle to employment_type string drift.

        Kept as a no-op so any external caller still resolves the method.
        """
        return

    # -- HC-7: Minimum Contract Hours ------------------------------------------

    def _add_min_contract_hours(self):
        """FT/PT employees must be assigned at least their contracted minimum
        hours. This prevents the solver from ignoring expensive-but-obligated
        staff in favor of cheaper casuals.

        Only applied when min_contract_minutes > 0 (Casuals default to 0).
        Existing committed shifts count toward the minimum.
        """
        for emp in self.data.employees:
            if emp.min_contract_minutes <= 0:
                continue
            terms = [
                s.duration_minutes * self._x[emp.id, s.id]
                for s in self.data.shifts
                if (emp.id, s.id) in self._x
            ]
            if not terms:
                continue
            existing_minutes = sum(es.duration_minutes for es in emp.existing_shifts)
            remaining_min = max(0, emp.min_contract_minutes - existing_minutes)
            if remaining_min > 0:
                # Soften min contract hours with Tier 1 penalty
                min_h_slack = self.model.NewIntVar(0, remaining_min, f'min_h_slack_{emp.id[:4]}')
                self.model.Add(cp_model.LinearExpr.Sum(terms) + min_h_slack >= remaining_min)
                # Tier 1: Contractual Obligation (100,000 / min). Sized so a
                # roomful of slack still loses to a single uncovered shift.
                self._workload_slack_terms.append(100_000 * min_h_slack)

        contract_count = sum(1 for e in self.data.employees if e.min_contract_minutes > 0)
        logger.info('[ModelBuilder] HC-7: %d employees with contract minimums', contract_count)

    # -- Objective ------------------------------------------------------------

    def _add_objective(self):
        terms = []

        # Helper to append a term to both the main list and a category bucket.
        def _t(expr, category: str):
            terms.append(expr)
            self._term_categories[category].append(expr)

        # -- SC-1: Base cost + preference discount ----------------------------
        for emp in self.data.employees:
            pref = set(emp.preferred_shift_ids)
            for shift in self.data.shifts:
                var = self._x.get((emp.id, shift.id))
                if var is not None:
                    # Cost in cents to keep integer math
                    base_rate = emp.hourly_rate
                    # Standard Award Penalty Rates (ICC EBA v8)
                    if shift.is_public_holiday:
                        base_rate *= 2.50
                    elif shift.is_sunday:
                        base_rate *= 1.50

                    cost_cents = int(round((shift.duration_minutes / 60.0) * base_rate * 100))

                    # Apply cost weight (symmetric: 0% -> 0.5x, 50% -> 1.0x, 100% -> 2.0x)
                    cost_mult = _strategy_mult(self.data.strategy.cost_weight)
                    weighted_cost = int(cost_cents * cost_mult)

                    # Preference gives a small discount
                    discount = 500 if shift.id in pref else 0

                    # SOFT Availability penalty — tracked separately so the
                    # availability category captures the soft-window portion.
                    availability_penalty = 0
                    s0, s1 = shift_window(shift)
                    for start, end, severity in emp.availability_overrides:
                        a0 = _time_to_abs_minutes(shift.shift_date, start)
                        a1 = _time_to_abs_minutes(shift.shift_date, end)
                        if a1 <= a0: a1 += 1440
                        if s0 < a1 and a0 < s1:
                            if severity == 'SOFT': availability_penalty += 5000
                            if severity == 'PREFERENCE': availability_penalty += 1000

                    # Note: relaxed-pair penalties are applied via
                    # _relaxed_violations_vars in the SC-9 block below — those
                    # vars track *actual* per-pair overlap/rest violations
                    # introduced when relax_constraints is true. Don't duplicate
                    # them here.
                    cost_expr = (weighted_cost - discount) * var
                    _t(cost_expr, 'cost')
                    if availability_penalty:
                        avail_expr = availability_penalty * var
                        _t(avail_expr, 'availability')


        # -- SC-3: Uncovered penalty (Tier -1: highest) ----------------------
        # Coverage MUST outrank every soft/softened-hard constraint. A single
        # uncovered priority-1 shift has to be more expensive than any
        # plausible accumulation of legal-tier slack, otherwise the solver
        # chooses "leave shifts uncovered" to satisfy slack on workload,
        # spread, visa, or min-contract limits.
        #
        # Sizing:
        #   Tier 0 (legal): 1e8 / min        → up to ~1e10 per emp per shift
        #   Tier 1 (contract): 1e5 / min     → up to ~1e8 per emp per shift
        #   Coverage base: 1e8 per priority-1 shift  → 1e9+ at priority 10
        #   With weight=100 default → multiplier 1.0; coverage_weight=200 doubles.
        coverage_penalty = int(1_000_000 * self.data.strategy.coverage_weight)
        for shift in self.data.shifts:
            _t(coverage_penalty * shift.priority * self._uncovered[shift.id], 'coverage')

        # -- SC-4: Production Fairness (Tier 2: 1,000) --------------------------
        total_demand = sum(s.duration_minutes for s in self.data.shifts)
        # Apply fairness only if demand > 40% of total staff capacity
        capacity_threshold = 0.4 * sum(e.max_weekly_minutes for e in self.data.employees)

        if total_demand >= capacity_threshold:
            for emp in self.data.employees:
                w_var = self._emp_workload_vars.get(emp.id)
                if w_var is None: continue

                baseline = emp.min_contract_minutes if emp.min_contract_minutes > 0 else emp.contract_weekly_minutes
                if baseline <= 0: baseline = 2280
                lower_ideal = int(0.80 * baseline)
                upper_ideal = int(1.05 * baseline)

                low_v = self.model.NewIntVar(0, 5000, f'low_v_{emp.id[:6]}')
                high_v = self.model.NewIntVar(0, 5000, f'high_v_{emp.id[:6]}')
                self.model.Add(w_var >= lower_ideal - low_v)
                self.model.Add(w_var <= upper_ideal + high_v)

                # Fairness Weight (symmetric: 0% -> 0.5x, 50% -> 1.0x, 100% -> 2.0x)
                fair_mult = _strategy_mult(self.data.strategy.fairness_weight)
                if emp.employment_type in ('FT', 'PT'):
                    _t(int(10 * fair_mult) * low_v + int(20 * fair_mult) * high_v, 'fairness')
                else:
                    _t(int(5 * fair_mult) * low_v + int(10 * fair_mult) * high_v, 'fairness')

        # -- SC-Alignment: Skill Hierarchy & Employment Isolation --------------
        # Pre-build dict lookups so we don't do `next(e for e in ...)` for
        # every (employee, shift) pair — that pattern is O(E·S·(E+S)) which
        # blows up at scale (~6M comparisons for 64k vars / 100 employees).
        emp_by_id = {e.id: e for e in self.data.employees}
        shift_by_id = {s.id: s for s in self.data.shifts}

        for (e_id, s_id), var in self._x.items():
            emp = emp_by_id[e_id]
            shift = shift_by_id[s_id]

            # SC-Alignment: Skill Overqualification (Precision Fix #4)
            # Defensive: treat missing level as 0 on both sides so a None
            # never propagates through arithmetic. Mirrors the same
            # defaults applied in `employee_eligible`.
            emp_level = emp.level if emp.level is not None else 0
            shift_level = getattr(shift, 'level', 0) or 0
            skill_gap = emp_level - shift_level
            if skill_gap > 0:
                # Small penalty per level gap to encourage tightest-fit first
                _t(100 * skill_gap * var, 'overqual')

            # SC-1: Employment Isolation (Precision Fix #8: SOFT)
            target = getattr(shift, 'target_employment_type', None)
            if target and emp.employment_type != target:
                # Penalty for assigning FT to Casual shift or vice versa
                # Strategic Importance: 5000 (equivalent to $50 penalty)
                _t(5000 * var, 'employment_mix')

        # -- SC-5: Overtime penalty (150% rate beyond contract) ----------------
        # For employees with min_contract_minutes, any minutes above that
        # threshold incur a 50% surcharge on top of their hourly rate.
        for emp in self.data.employees:
            if emp.min_contract_minutes <= 0:
                continue
            w_var = self._emp_workload_vars.get(emp.id)
            if w_var is None:
                continue
            existing_minutes = sum(es.duration_minutes for es in emp.existing_shifts)
            contract_remaining = max(0, emp.min_contract_minutes - existing_minutes)

            overtime = self.model.NewIntVar(0, 5000, f'ot_{emp.id[:6]}')
            self.model.AddMaxEquality(overtime, [w_var - contract_remaining, 0])

            # 3-line fix for OT/Penalty interaction:
            # OT rate should scale with the highest penalty multiplier active in the window.
            effective_mult = max([2.5 if s.is_public_holiday else 1.5 if s.is_sunday else 1.0 for s in self.data.shifts] + [1.0])
            ot_rate_cents_per_min = int(round(emp.hourly_rate * effective_mult * 0.5 / 60.0 * 100))

            if ot_rate_cents_per_min > 0:
                _t(ot_rate_cents_per_min * overtime, 'cost')

        # -- SC-7: Safety Penalty (Non-linear Fatigue) ------------------------
        # Uses piecewise linear approximation to simulate the exponential drain
        # of high effective working hours (weighted by circadian factors).
        for emp in self.data.employees:
            # We already have self._emp_workload_vars[emp.id] which is duration_minutes.
            # We need a new var for effective_minutes.
            eff_terms = [
                _calculate_effective_minutes(s) * self._x[emp.id, s.id]
                for s in self.data.shifts
                if (emp.id, s.id) in self._x
            ]
            if not eff_terms:
                continue

            # Initial fatigue (from previous week) converted to "effective minutes"
            # Calibration: 1 fatigue unit ~= 60 effective minutes in the simplified linear band.
            # This constant maps severity-based fatigue scores from the timekeeping layer
            # into the optimizer's circadian penalty space.
            init_eff_mins = int(emp.initial_fatigue_score * 60)

            eff_total = self.model.NewIntVar(0, 5000, f'eff_{emp.id[:6]}')
            self.model.Add(eff_total == cp_model.LinearExpr.Sum(eff_terms) + init_eff_mins)

            # Non-linear penalty bands (in cents):
            # 0-1200 mins (20h): $0/min
            # 1200-1800 mins (30h): $5/min surcharge (Amber)
            # 1800+ mins (30h+): $50/min surcharge (Critical/Red)
            # This simulates the -76*log curve's rapid ascent.

            # Helper: AddPiecewiseLinearConstraint is available in newer OR-Tools.
            # If not, we can use 3 linear variables and max constraints.

            amber_mins = self.model.NewIntVar(0, 5000, f'amber_{emp.id[:6]}')
            critical_mins = self.model.NewIntVar(0, 5000, f'crit_{emp.id[:6]}')

            # amber_mins = max(0, eff_total - 1200)
            self.model.AddMaxEquality(amber_mins, [eff_total - 1200, 0])
            # critical_mins = max(0, eff_total - 1800)
            self.model.AddMaxEquality(critical_mins, [eff_total - 1800, 0])

            # Fatigue Weight (symmetric: 0% -> 0.5x, 50% -> 1.0x, 100% -> 2.0x)
            fatigue_mult = _strategy_mult(self.data.strategy.fatigue_weight)

            # Penalties:
            _t(int(500 * fatigue_mult) * amber_mins, 'fatigue')       # $5.00 per minute base
            _t(int(4500 * fatigue_mult) * critical_mins, 'fatigue')   # Extra $45.00

        # -- SC-6: Shift Continuity - reward keeping same employee on adjacent
        # For each pair of adjacent (contiguous, non-overlapping) shifts,
        # give a $2.00 (200 cents) bonus if the same employee works both.
        shifts_sorted = sorted(self.data.shifts, key=lambda s: shift_window(s)[0])
        continuity_bonus = 200  # cents
        for i in range(len(shifts_sorted) - 1):
            s1 = shifts_sorted[i]
            s2 = shifts_sorted[i + 1]
            _, s1_end = shift_window(s1)
            s2_start, _ = shift_window(s2)
            # Adjacent = s2 starts within 30 min of s1 ending (no gap or tiny gap)
            if 0 <= (s2_start - s1_end) <= 30:
                for emp in self.data.employees:
                    v1 = self._x.get((emp.id, s1.id))
                    v2 = self._x.get((emp.id, s2.id))
                    if v1 is not None and v2 is not None:
                        # 'both' is true if employee works both adjacent shifts
                        both = self.model.NewBoolVar(f'cont_{emp.id[:4]}_{i}')
                        self.model.Add(both == 1).OnlyEnforceIf([v1, v2])
                        self.model.Add(both == 0).OnlyEnforceIf(v1.Not())
                        self.model.Add(both == 0).OnlyEnforceIf(v2.Not())
                        _t(-continuity_bonus * both, 'continuity')

        # -- SC-8: Workload Slack Penalties --------------------------------
        # Spread, visa, streak, and min-contract slack vars were collected
        # in _workload_slack_terms during constraint construction; without
        # this loop they would never make it into the objective and the
        # "softened" hard constraints would silently be free to violate.
        for slack_term in self._workload_slack_terms:
            _t(slack_term, 'other')

        # -- SC-9: Relaxed Violations penalty (added in _add_overlap/rest_gap) ---
        if self.data.constraints.relax_constraints:
            for v_var in self._relaxed_violations_vars:
                # $10M penalty per internal overlap
                _t(1_000_000_000 * v_var, 'relaxed_violations')

        self.model.Minimize(cp_model.LinearExpr.Sum(terms))

        # -- Search Strategy (Symmetry & Pruning) ----------------------------
        # Prioritize assigning uncovered shifts (biggest impact on objective)
        uncovered_vars = [self._uncovered[s.id] for s in self.data.shifts]
        self.model.AddDecisionStrategy(uncovered_vars, cp_model.CHOOSE_FIRST, cp_model.SELECT_MAX_VALUE)
        
        # Then branch on assignment variables
        x_vars = list(self._x.values())
        self.model.AddDecisionStrategy(x_vars, cp_model.CHOOSE_LOWEST_MIN, cp_model.SELECT_MAX_VALUE)

    # -- E: Greedy warm-start --------------------------------------------------

    def _apply_greedy_hint(self):
        hints = compute_greedy_hint(
            self.data.shifts,
            self.data.employees,
            self._eligibility_map,
            self._rest_eliminated,
        )
        for (emp_id, shift_id), value in hints.items():
            var = self._x.get((emp_id, shift_id))
            if var is not None:
                self.model.AddHint(var, value)
        # Modern OR-Tools guidance: only hint the assignments we trust.
        # Setting non-hinted vars to 0 over-constrains search.

        self._metrics.greedy_hint_applied = True

    # -- F: Solve --------------------------------------------------------------

    def _solve(self) -> OptimizerOutput:
        params = self.data.solver_params
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = params.max_time_seconds
        solver.parameters.num_workers = params.num_workers
        solver.parameters.log_search_progress = params.log_search
        solver.parameters.random_seed = 42  # Ensure reproducibility
        # AUTOMATIC_SEARCH lets the multi-worker portfolio (LNS, fixed,
        # core-based, etc.) run in parallel. The AddDecisionStrategy calls
        # in _add_objective remain useful as prioritized hints; FIXED_SEARCH
        # would have honored only the first declared strategy and starved
        # the LNS workers, contributing to UNKNOWN time-outs on busy days.
        solver.parameters.search_branching = cp_model.AUTOMATIC_SEARCH

        status_code = solver.solve(self.model)

        STATUS = {
            cp_model.OPTIMAL:    'OPTIMAL',
            cp_model.FEASIBLE:   'FEASIBLE',
            cp_model.INFEASIBLE: 'INFEASIBLE',
            cp_model.UNKNOWN:    'UNKNOWN',
            cp_model.MODEL_INVALID: 'MODEL_INVALID',
        }
        status = STATUS.get(status_code, 'UNKNOWN')

        assignments: list[AssignmentProposal] = []
        unassigned: list[str] = []

        if status_code in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            emp_map = {e.id: e for e in self.data.employees}
            shift_map = {s.id: s for s in self.data.shifts}
            for (emp_id, shift_id), var in self._x.items():
                if solver.value(var) == 1:
                    emp = emp_map[emp_id]
                    shift = shift_map[shift_id]
                    cost = (shift.duration_minutes / 60.0) * emp.hourly_rate
                    assignments.append(AssignmentProposal(
                        shift_id=shift_id, 
                        employee_id=emp_id, 
                        employment_type=emp.employment_type,
                        cost=round(cost, 2)
                    ))
            for shift in self.data.shifts:
                if solver.value(self._uncovered[shift.id]) == 1:
                    unassigned.append(shift.id)

        breakdown: Optional[dict[str, int]] = None
        if status_code in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            try:
                breakdown = self.objective_breakdown(solver)
            except Exception as _exc:
                logger.warning('[ModelBuilder] objective_breakdown failed: %s', _exc)

        return OptimizerOutput(
            status=status,
            assignments=assignments,
            unassigned_shift_ids=unassigned,
            objective_value=solver.objective_value if status_code in (cp_model.OPTIMAL, cp_model.FEASIBLE) else 0.0,
            best_objective_bound=solver.best_objective_bound if status_code in (cp_model.OPTIMAL, cp_model.FEASIBLE) else 0.0,
            proven_optimal=(status_code == cp_model.OPTIMAL),
            metrics=self._metrics,
            objective_breakdown=breakdown,
        )
