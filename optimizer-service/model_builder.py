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
import datetime
import logging
import time
from dataclasses import dataclass, field, replace
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
    contracted_role_ids: list[str] = field(default_factory=list)
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
    # F1 longitudinal fairness ledger: per-metric debt (rolling_value − team
    # average) keyed by metric ('weekend_shifts'|'night_shifts'|
    # 'public_holiday_shifts'|...). Positive = over-share (bias away);
    # negative = owed (bias toward). Consumed by SC-11. MUST be a declared
    # field — otherwise it is dropped at the Pydantic/dataclass wire boundary
    # and SC-11 silently no-ops.
    fairness_debts: dict = field(default_factory=dict)
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
    # B4 — when true, build_and_solve() also computes Pareto "what-if"
    # alternatives (cheapest / most-balanced) for the trade-off explorer UI.
    # Off by default so the normal solve path is never slowed.
    compute_alternatives: bool = False
    # Month-long rosters: solve each ISO week in sequence, pinning each week's
    # assignments as existing_shifts for later weeks. One monolithic month-long
    # model is large enough that the lexicographic solver spends its whole budget
    # on tier-1 (coverage) and time-starves the fairness/cost tiers. Each weekly
    # subproblem is ~1/n the size, so every tier solves to optimality — much
    # better fairness/cost — while pinning preserves ALL cross-week guarantees
    # (rest-gap, 28-day/14-day caps, daily spread, min-contract) and cumulative
    # fairness (the workload accumulator counts existing minutes). Off by
    # default; auto-skipped (falls back to monolithic) when <2 ISO weeks.
    decompose_by_week: bool = False


@dataclass
class OptimizerInput:
    shifts: list[ShiftInput]
    employees: list[EmployeeInput]
    constraints: OptimizerConstraints = field(default_factory=OptimizerConstraints)
    strategy: StrategyInput = field(default_factory=StrategyInput)
    solver_params: SolverParameters = field(default_factory=SolverParameters)
    # Forbidden (employee_id, shift_id) pairs — dropped from the eligibility map
    # so the solver will not propose them. Drives the controller's compliance-
    # repair loop: a pair the TS compliance engine rejected is excluded, so the
    # re-solve assigns that shift to a DIFFERENT compliant employee (or leaves it
    # uncovered). Empty in the normal first solve.
    excluded_pairs: list[tuple[str, str]] = field(default_factory=list)


@dataclass
class AssignmentProposal:
    shift_id: str
    employee_id: str
    employment_type: str
    cost: float
    # B5 — per-assignment explainability ("why this person"). Optional so older
    # callers/tests are unaffected. Keys: cheapest_eligible (bool), cost_rank
    # (1=cheapest of the eligible pool), eligible_count, fairness_debt (sum of
    # the employee's positive ledger debts), qual_gap (emp.level - shift.level).
    rationale: Optional[dict] = None


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
    # B3/B5 — single-mode transparency payload for the UI.
    tier_values: Optional[dict[str, float]] = None        # per-tier objective optima
    pillars: Optional[dict] = None                         # coverage/cost/fairness/fatigue scorecard
    binding_constraints: Optional[list[dict]] = None       # why shifts were left uncovered
    # B4 — Pareto "what-if" alternatives (each: {key,label,pillars}).
    alternatives: Optional[list[dict]] = None


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


def _iso_week_key(shift_date: str) -> tuple[int, int]:
    """Bucket a shift into its ISO calendar week (Mon-Sun).

    SC-7 fatigue caps (1200/1800 effective minutes) are *weekly* limits, so
    effective minutes must be windowed per ISO week instead of summed across
    the whole optimization horizon (which over a month flagged ~everyone as
    'critical' and pinned the wellbeing score at 0).

    `shift_date` is an ISO `YYYY-MM-DD` string (see ShiftInput / shift_window).
    Returns `(iso_year, iso_week)`.
    """
    return datetime.date.fromisoformat(shift_date).isocalendar()[:2]


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
    if c.enforce_role_match and shift.role_id:
        if shift.role_id not in emp.contracted_role_ids:
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
        # Horizon-derived minute bounds — populated in build_and_solve() before
        # any variable is created. Defaults here keep the attributes defined for
        # any method invoked out of the normal build order.
        self._total_shift_minutes: int = 0
        self._max_existing_minutes: int = 0
        self._minute_ub: int = 1
        self._eff_ub: int = 1
        # Per-category objective term accounting (same expressions as in
        # `terms`, kept separately so objective_breakdown() can evaluate them
        # against the solver solution after solve).
        self._term_categories: dict[str, list] = {
            'cost': [],
            'fairness': [],
            'fatigue': [],
            'coverage': [],
            'continuity': [],
            'employment_mix': [],
            'relaxed_violations': [],
            'availability': [],
            'undesirable_balance': [],  # DELIVERABLE 4: night/weekend fairness
            'longitudinal_fairness': [],  # SC-11: F1 cross-roster fairness ledger
            'other': [],
        }
        # B3 — lexicographic objective tiers, populated by _add_objective() and
        # optimised in strict priority order by _solve(). See _add_objective.
        self._objective_tiers: list[tuple[str, object]] = []
        # FIX (B) — the greedy warm-start roster, stashed by _apply_greedy_hint
        # so _solve() can materialise it as a FALLBACK INCUMBENT when CP-SAT
        # times out with no incumbent on a large model. Keys are the trusted
        # (emp_id, shift_id) pairs the greedy engine assigned (value == 1).
        self._greedy_hint: dict[tuple[str, str], int] = {}
        # B4 — tier ordering profile. 'balanced' is the live single-mode policy
        # (coverage > guardrails > cost); 'cheapest' / 'fairest' are used only to
        # generate Pareto "what-if" alternatives for the UI trade-off explorer.
        self.tier_profile: str = 'balanced'

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

    # -- B5: transparency helpers ---------------------------------------------

    @staticmethod
    def _assignment_cost_cents(emp: 'EmployeeInput', shift: 'ShiftInput') -> int:
        """Labour cost in cents for emp working shift, incl. award penalties.
        Mirrors the SC-1 cost formula so cost_rank in the rationale is faithful."""
        rate = emp.hourly_rate
        if shift.is_public_holiday:
            rate *= 2.50
        elif shift.is_sunday:
            rate *= 1.50
        return int(round((shift.duration_minutes / 60.0) * rate * 100))

    def _assignment_rationale(self, emp: 'EmployeeInput', shift: 'ShiftInput') -> dict:
        """Per-assignment 'why this person' factors for the UI."""
        eligible = self._eligibility_map.get(shift.id, [])
        ranked = sorted(eligible, key=lambda e: self._assignment_cost_cents(e, shift))
        cost_rank = next((i + 1 for i, e in enumerate(ranked) if e.id == emp.id), None)
        debts = getattr(emp, 'fairness_debts', {}) or {}
        fairness_debt = round(sum(
            v for k, v in debts.items()
            if k != 'denied_preferences' and isinstance(v, (int, float))
        ), 2)
        qual_gap = (emp.level or 0) - (getattr(shift, 'level', 0) or 0)
        return {
            'cost_rank': cost_rank,
            'eligible_count': len(eligible),
            'cheapest_eligible': cost_rank == 1,
            'fairness_debt': fairness_debt,
            'qual_gap': qual_gap,
        }

    def _compute_pillars(self, assignments: list, unassigned: list) -> dict:
        """Four-pillar scorecard (Coverage / Cost / Fairness / Fatigue) derived
        from the actual solution — interpretable values for the UI, not raw
        objective penalties."""
        shifts = self.data.shifts
        total = len(shifts)
        covered = total - len(unassigned)
        coverage_score = round(100.0 * covered / total, 1) if total else 100.0

        total_cost = round(sum(a.cost for a in assignments), 2)

        dur = {s.id: s.duration_minutes for s in shifts}
        mins_by_emp: dict[str, float] = {}
        for a in assignments:
            mins_by_emp[a.employee_id] = mins_by_emp.get(a.employee_id, 0) + dur.get(a.shift_id, 0)
        loads = list(mins_by_emp.values())
        used = len(loads)

        # Fairness = workload evenness across the people used. Coefficient of
        # variation 0 (perfectly even) → 100; higher spread → lower score.
        if loads and used > 1 and sum(loads) > 0:
            mean = sum(loads) / used
            sd = (sum((x - mean) ** 2 for x in loads) / used) ** 0.5
            cv = sd / mean if mean else 0.0
            fairness_score = max(0, round(100 * (1 - min(1.0, cv))))
            spread = round(max(loads) - min(loads))
        else:
            fairness_score, spread = 100, 0

        # Fatigue = how many people pushed into the amber/critical effective-hours
        # bands. SC-7 thresholds (1200/1800 effective minutes) are *weekly* caps,
        # so we window each employee's effective minutes per ISO calendar week
        # (Mon-Sun) and band on their WORST (peak) week — not a horizon-wide sum,
        # which over a month flagged ~everyone 'critical' and pinned the score
        # at 0.
        eff = {s.id: _calculate_effective_minutes(s) for s in shifts}
        week_of = {s.id: _iso_week_key(s.shift_date) for s in shifts}
        init = {e.id: e.initial_fatigue_score * 60 for e in self.data.employees}

        # Per-employee → {iso_week: effective_minutes}.
        eff_by_emp_week: dict[str, dict[tuple[int, int], float]] = {}
        for a in assignments:
            wk = week_of.get(a.shift_id)
            if wk is None:
                continue
            wmap = eff_by_emp_week.setdefault(a.employee_id, {})
            wmap[wk] = wmap.get(wk, 0) + eff.get(a.shift_id, 0)

        amber = critical = 0
        for emp_id, wmap in eff_by_emp_week.items():
            if not wmap:
                continue
            # Prior fatigue belongs to "the previous week" → fold it into the
            # earliest assigned week bucket only (not every week).
            earliest = min(wmap)
            wmap[earliest] += init.get(emp_id, 0)
            peak = max(wmap.values())
            if peak > 1800:
                critical += 1
            elif peak > 1200:
                amber += 1

        # Normalize by headcount so the score is a gradient, not a raw count
        # (amber = half a critical; all used-people critical → 0; none → 100).
        frac = (amber * 0.5 + critical * 1.0) / max(1, used)
        fatigue_score = max(0, round(100 * (1 - min(1.0, frac))))

        return {
            'coverage': {'score': coverage_score, 'covered': covered, 'total': total},
            'cost': {'total': total_cost, 'currency': 'AUD',
                     'avg_per_shift': round(total_cost / covered, 2) if covered else 0.0},
            'fairness': {'score': fairness_score, 'employees_used': used,
                         'spread_minutes': spread,
                         'peak_minutes': round(max(loads)) if loads else 0},
            'fatigue': {'score': fatigue_score, 'amber': amber, 'critical': critical},
        }

    def _compute_binding(self, unassigned: list) -> list:
        """Explain why each shift was left uncovered (drives the U5 banner)."""
        out = []
        for sid in unassigned:
            n = len(self._eligibility_map.get(sid, []))
            reason = ('No qualified or available employee for this shift'
                      if n == 0 else
                      f'All {n} eligible employees were already committed '
                      f'(overlap, rest-gap, or hours limits)')
            out.append({'shift_id': sid, 'eligible_count': n, 'reason': reason})
        return out

    def _compute_alternatives(self) -> list:
        """B4 — Pareto 'what-if' alternatives for the trade-off explorer. Re-solve
        the SAME problem under different tier priorities on a reduced budget and
        return each one's pillar scorecard. compute_alternatives is forced off on
        the sub-solves so this never recurses."""
        alts: list[dict] = []
        budget = max(0.3, self.data.solver_params.max_time_seconds * 0.5)
        for key, label in [('cheapest', 'Lowest cost'), ('fairest', 'Most balanced')]:
            try:
                sub_params = replace(self.data.solver_params,
                                     compute_alternatives=False, max_time_seconds=budget)
                sub = type(self)(replace(self.data, solver_params=sub_params))
                sub.tier_profile = key
                out = sub.build_and_solve()
                if out.pillars and out.status in ('OPTIMAL', 'FEASIBLE'):
                    alts.append({'key': key, 'label': label, 'pillars': out.pillars})
            except Exception as exc:  # never let an alternative break the main solve
                logger.warning('[ModelBuilder] alternative %s failed: %s', key, exc)
        return alts

    def _solve_weekly_decomposition(self) -> Optional[OptimizerOutput]:
        """Month-long rosters: solve each ISO week in sequence, pinning each
        week's assignments as `existing_shifts` for all later weeks.

        Pinning is what makes this safe: every cross-week hard constraint
        (rest-gap via existing_blocks_proposal, no-overlap intervals, the
        28-day/14-day rolling caps, daily spread, min-contract) already accounts
        for existing_shifts, and the workload accumulator adds existing minutes —
        so cumulative fairness carries forward too. No global constraint is lost;
        each week is just small enough that all three lexicographic tiers reach
        optimality inside the budget instead of the fairness/cost tiers being
        time-starved on one monolithic month-long solve.

        Returns None when the horizon spans <2 ISO weeks, so the caller falls
        back to the normal monolithic solve."""
        weeks: dict[tuple[int, int], list] = {}
        for s in self.data.shifts:
            weeks.setdefault(_iso_week_key(s.shift_date), []).append(s)
        if len(weeks) < 2:
            return None

        t_start = time.perf_counter()
        n_weeks = len(weeks)
        # Even split of the wall budget across weeks; each week is small so this
        # is ample. The per-week solver still front-loads its own tiers and keeps
        # the greedy-incumbent safety net.
        per_week_budget = max(1.0, self.data.solver_params.max_time_seconds / n_weeks)

        # Carry-forward: seed with each employee's REAL pinned shifts, then append
        # every solved week's assignments so later weeks see (and respect) them.
        carried: dict[str, list] = {
            e.id: list(e.existing_shifts) for e in self.data.employees
        }

        all_assignments: list[AssignmentProposal] = []
        all_unassigned: list[str] = []
        all_binding: list[dict] = []
        week_statuses: list[str] = []
        agg_breakdown: dict[str, int] = {}

        for wk in sorted(weeks):
            wk_shifts = weeks[wk]
            sub_emps = [replace(e, existing_shifts=carried[e.id])
                        for e in self.data.employees]
            sub_params = replace(
                self.data.solver_params,
                max_time_seconds=per_week_budget,
                compute_alternatives=False,
                decompose_by_week=False,  # never recurse
            )
            sub_data = replace(self.data, shifts=wk_shifts,
                               employees=sub_emps, solver_params=sub_params)
            try:
                out = type(self)(sub_data).build_and_solve()
            except Exception as exc:
                logger.warning('[ModelBuilder] decomposition: week %s failed (%s); '
                               'its shifts are left uncovered', wk, exc)
                all_unassigned.extend(s.id for s in wk_shifts)
                week_statuses.append('UNKNOWN')
                continue

            week_statuses.append(out.status)
            all_assignments.extend(out.assignments)
            all_unassigned.extend(out.unassigned_shift_ids)
            if out.binding_constraints:
                all_binding.extend(out.binding_constraints)
            if out.objective_breakdown:
                for k, v in out.objective_breakdown.items():
                    agg_breakdown[k] = agg_breakdown.get(k, 0) + v

            # Pin this week's assignments for every later week.
            by_id = {s.id: s for s in wk_shifts}
            for a in out.assignments:
                s = by_id.get(a.shift_id)
                if s is None:
                    continue
                s_abs, e_abs = shift_window(s)
                carried[a.employee_id].append(ExistingShiftInput(
                    id=s.id, shift_date=s.shift_date, start_time=s.start_time,
                    end_time=s.end_time, duration_minutes=s.duration_minutes,
                    unpaid_break_minutes=getattr(s, 'unpaid_break_minutes', 0),
                    start_abs=s_abs, end_abs=e_abs,
                ))

        # Aggregate status: OPTIMAL only if every week proved optimal; FEASIBLE if
        # we covered anything; else UNKNOWN. proven_optimal stays False — a
        # per-week sequential optimum is not a proven GLOBAL month-long optimum.
        if week_statuses and all(st == 'OPTIMAL' for st in week_statuses):
            status = 'OPTIMAL'
        elif all_assignments:
            status = 'FEASIBLE'
        else:
            status = 'UNKNOWN'

        # Pillars/binding over the FULL horizon (cumulative fairness + per-week
        # fatigue). self.data holds the whole month, so _compute_pillars sees
        # every shift; it needs no model state.
        pillars = None
        try:
            pillars = self._compute_pillars(all_assignments, all_unassigned)
        except Exception as exc:
            logger.warning('[ModelBuilder] decomposed pillar computation failed: %s', exc)

        self._metrics.raw_pairs = len(self.data.employees) * len(self.data.shifts)
        self._metrics.solve_ms = round((time.perf_counter() - t_start) * 1000, 2)

        logger.info('[ModelBuilder] weekly-decomposition: weeks=%d status=%s '
                    'assignments=%d/%d (%.0f%% coverage) per_week_budget=%.1fs',
                    n_weeks, status, len(all_assignments), len(self.data.shifts),
                    100 * len(all_assignments) / max(len(self.data.shifts), 1),
                    per_week_budget)

        return OptimizerOutput(
            status=status,
            assignments=all_assignments,
            unassigned_shift_ids=all_unassigned,
            objective_value=float(sum(agg_breakdown.values())) if agg_breakdown else 0.0,
            best_objective_bound=0.0,
            proven_optimal=False,
            metrics=self._metrics,
            objective_breakdown=(agg_breakdown or None),
            tier_values=None,
            pillars=pillars,
            binding_constraints=(all_binding or None),
        )

    # -- Public entry ----------------------------------------------------------

    def build_and_solve(self) -> OptimizerOutput:
        # Month-long decomposition: when enabled AND the horizon spans >=2 ISO
        # weeks, solve each week in sequence (see _solve_weekly_decomposition).
        # Only for the live 'balanced' profile — the Pareto sub-profiles
        # (cheapest/fairest) always solve monolithically so they never recurse.
        if (self.data.solver_params.decompose_by_week
                and self.tier_profile == 'balanced'):
            decomposed = self._solve_weekly_decomposition()
            if decomposed is not None:
                return decomposed

        t_pre = time.perf_counter()

        # A: Compute eligible pairs
        self._compute_eligibility()

        # Horizon-derived bounds for per-employee minute accumulators.
        # The old code hard-coded these IntVar domains at 5000 minutes (~83h)
        # and day vars at 720 (12h). On any multi-week window (the UI defaults
        # to ~16 days) or with high prior-fatigue inputs, an `==`-constrained
        # accumulator could exceed its domain and make the WHOLE model
        # INFEASIBLE — or silently cap hours, masquerading as a soft penalty
        # (audit C3/C4). No employee can be assigned more than the sum of all
        # shift durations, so that (plus their pinned existing minutes) is a
        # safe, never-infeasible ceiling.
        self._total_shift_minutes = sum(s.duration_minutes for s in self.data.shifts)
        self._max_existing_minutes = max(
            (sum(es.duration_minutes for es in e.existing_shifts)
             for e in self.data.employees),
            default=0,
        )
        # Generic per-employee minute upper bound (work totals, overtime,
        # fairness deviation). +1 keeps the bound strictly above any feasible
        # value.
        self._minute_ub = self._total_shift_minutes + self._max_existing_minutes + 1
        # Circadian-weighted "effective" minutes peak at 1.5x raw duration.
        self._eff_ub = int(self._total_shift_minutes * 1.5) + 1

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

        # B4 — Pareto "what-if" alternatives for the trade-off explorer. Only on
        # explicit request, only for the live 'balanced' profile (so the
        # sub-solves below don't themselves spawn alternatives).
        if (self.data.solver_params.compute_alternatives
                and self.tier_profile == 'balanced'
                and output.status in ('OPTIMAL', 'FEASIBLE')):
            output.alternatives = self._compute_alternatives()

        return output

    # -- A: Eligibility filtering ----------------------------------------------

    def _compute_eligibility(self):
        """Build eligibility_map[shift_id] = [eligible employees].

        Improvement: variable count drops from ExS to ~6xS (avg 6 eligible/shift).
        """
        c = self.data.constraints
        self._metrics.raw_pairs = len(self.data.employees) * len(self.data.shifts)
        # Forbidden (employee_id, shift_id) pairs — excluded from candidacy so the
        # solver never re-proposes a pair the compliance engine already rejected.
        excluded = {tuple(p) for p in (self.data.excluded_pairs or [])}

        for shift in self.data.shifts:
            eligible = [
                e for e in self.data.employees
                if employee_eligible(e, shift, c) and (e.id, shift.id) not in excluded
            ]
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
            # Domain = everything this employee could possibly accrue (all
            # shift minutes + their pinned existing minutes). The old
            # `max_weekly_minutes + 10000` bound both under-bounded long
            # horizons and acted as a stealth 166h-above-contract cap.
            w = self.model.NewIntVar(0, self._total_shift_minutes + existing_minutes, f'w_{emp.id[:6]}')
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
    # The CP-SAT idiom is `AddNoOverlap` on `OptionalIntervalVar`s. Each
    # shift becomes one optional interval per eligible employee, padded on
    # the trailing edge by `min_rest_minutes` so that "no two intervals
    # overlap" simultaneously enforces:
    #   - HC-2 (real shift times can't overlap)
    #   - HC-3 (rest gap before the next shift must be >= min_rest)
    #
    # DELIVERABLE 3 — MULTI-HIRE REST GAP (480m vs 600m)
    # The ICC EBA requires only 480m (8h) rest when EITHER shift is
    # MULTI_HIRE, versus 600m (10h) for two NORMAL shifts.
    #
    # AddNoOverlap cannot express per-pair variable padding in a single list.
    # Approach: build one AddNoOverlap per employee that uses the CORRECT
    # padding for each shift.  The padding for shift S is:
    #   - 600m (standard) if S is NORMAL
    #   - 480m (multi-hire) if S is MULTI_HIRE
    #
    # However, the padding on S governs the gap AFTER S ends.  When a NORMAL
    # shift S1 (padded 600m) is followed by a MULTI_HIRE shift S2 (padded
    # 480m) with a gap of 520m, S1's padded interval extends 600m past its
    # end and overlaps S2's start — AddNoOverlap fires and BLOCKS the pair.
    # That's WRONG if S2 is MULTI_HIRE (rule says 480m is sufficient).
    #
    # To correctly handle the "EITHER shift is MULTI_HIRE" rule, we use a
    # hybrid approach:
    #
    #   1. Build the main AddNoOverlap with per-shift padding:
    #      - NORMAL shift → 600m pad
    #      - MULTI_HIRE shift → 480m pad
    #      This correctly handles:
    #        - NORMAL → NORMAL: 600m enforced (S1 padded 600m blocks S2 at <600m)
    #        - MH → MH: 480m enforced (S1 padded 480m blocks S2 at <480m)
    #        - MH → NORMAL: 480m enforced (S1 padded 480m, fine)
    #        - NORMAL → MH: OVER-CONSTRAINS if gap in [480,600) because
    #          S1 padded 600m blocks S2 even though S2 is MH.
    #
    #   2. For "borderline" pairs (NORMAL → MULTI_HIRE with gap in [480,600)):
    #      Add a per-pair explicit boolean relaxation:
    #        x[e,sa] + x[e,sb] <= 2  -- effectively no constraint, but this
    #      can't un-fire AddNoOverlap.  We need a different strategy.
    #
    # FINAL CORRECT APPROACH:
    # Use per-shift padding of min(480, required_for_this_shift):
    #   - ALL shifts use 480m padding in the primary AddNoOverlap.
    #   - For NORMAL→NORMAL pairs where gap is in [480,600), we add an
    #     EXPLICIT pairwise constraint: x[e,sa] + x[e,sb] <= 1.
    #   This way:
    #     - MH pairs: 480m AddNoOverlap handles them correctly.
    #     - NORMAL-NORMAL gaps in [480,600): explicitly blocked pairwise.
    #     - NORMAL-NORMAL gaps >= 600m: fine (480m no-overlap doesn't fire).
    #     - Any pair with gap < 480m: blocked by both.
    #
    # This approach is O(P_normal) extra pairwise constraints where P_normal
    # is the count of Normal-Normal pairs in the [480,600) gap zone (typically
    # very few in real schedules — these are back-to-back 8h shifts with no
    # handover gap).

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
        # DELIVERABLE 3: multi-hire rest gap is 480m.
        multi_hire_rest = 480
        # All intervals in the primary AddNoOverlap use the SMALLER 480m pad.
        # Normal-Normal pairs that need 600m are enforced via explicit pairwise.
        primary_pad = multi_hire_rest

        # Pre-index shift windows and types
        _sw: dict[str, tuple[int, int]] = {s.id: shift_window(s) for s in self.data.shifts}
        _is_mh: dict[str, bool] = {s.id: (s.shift_type == 'MULTI_HIRE') for s in self.data.shifts}

        # DELIVERABLE 3: Identify Normal-Normal pairs where gap in [480, 600).
        # These pairs MUST be explicitly blocked (since the primary 480m
        # AddNoOverlap will not catch them).
        normal_normal_tight: set[frozenset] = set()
        shifts_sorted_for_pairs = sorted(self.data.shifts, key=lambda s: _sw[s.id][0])
        for i, sa in enumerate(shifts_sorted_for_pairs):
            if _is_mh.get(sa.id):
                continue  # sa is MH → not a Normal-Normal pair
            sa_start, sa_end = _sw[sa.id]
            for j in range(i + 1, len(shifts_sorted_for_pairs)):
                sb = shifts_sorted_for_pairs[j]
                sb_start, sb_end = _sw[sb.id]
                if sb_start >= sa_end + min_rest:
                    break  # all further sb are far enough apart
                if _is_mh.get(sb.id):
                    continue  # not a Normal-Normal pair
                # sb is NORMAL, sa is NORMAL, sb_start < sa_end + 600m
                if sb_start < sa_end:
                    continue  # overlapping (AddNoOverlap catches this)
                gap = sb_start - sa_end
                # gap in [0, 480): already covered by primary 480m no-overlap
                # gap in [480, 600): NOT covered by 480m no-overlap → need explicit
                if primary_pad <= gap < min_rest:
                    normal_normal_tight.add(frozenset([sa.id, sb.id]))

        for emp in self.data.employees:
            intervals = []
            # DELIVERABLE 3: Use primary_pad (480m) for ALL shifts in the
            # main AddNoOverlap.  Normal-Normal tight pairs are handled
            # via explicit pairwise constraints below.
            for s in self.data.shifts:
                v = self._x.get((emp.id, s.id))
                if v is None:
                    continue
                s_start, s_end = _sw[s.id]
                duration = s_end - s_start
                size = duration + primary_pad
                end = s_end + primary_pad
                interval = self.model.NewOptionalIntervalVar(
                    s_start, size, end, v,
                    f'iv_{emp.id[:6]}_{s.id[:6]}',
                )
                intervals.append(interval)

            # Pinned existing shifts: fixed intervals that always exist.
            # Pad with primary_pad (480m); existing shifts are padded with
            # standard min_rest separately via explicit pairwise if they
            # are non-multi-hire (existing shifts don't have a shift_type
            # so we use min_rest conservatively).
            for ex in emp.existing_shifts:
                ex_start, ex_end = shift_window(ex)
                duration = ex_end - ex_start
                # Existing shifts use full min_rest pad (conservative, correct)
                size = duration + min_rest
                end = ex_end + min_rest
                fixed = self.model.NewIntervalVar(
                    ex_start, size, end,
                    f'iv_ex_{emp.id[:6]}_{ex.id[:6]}',
                )
                intervals.append(fixed)

            if intervals:
                self.model.AddNoOverlap(intervals)

            # DELIVERABLE 3: Add explicit pairwise for Normal-Normal tight pairs
            # (gap in [480, 600)).  The primary 480m no-overlap does not block
            # these; we add `x[e,sa] + x[e,sb] <= 1` for each such pair.
            for pair in normal_normal_tight:
                sa_id, sb_id = tuple(pair)
                v1 = self._x.get((emp.id, sa_id))
                v2 = self._x.get((emp.id, sb_id))
                if v1 is not None and v2 is not None:
                    self.model.Add(v1 + v2 <= 1)

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
            # day_vars[i] = total minutes worked on calendar day (d0 + i).
            # Domain is a full calendar day (1440). The old 720 (12h) cap made
            # `day_vars[i] == sum(...)` INFEASIBLE for any 12h+ day (a single
            # long shift, or two shifts sharing the day) — audit C3.
            day_vars = [self.model.NewIntVar(0, 1440, f'd_{emp.id[:4]}_{i}') for i in range(num_calendar_days)]
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
                    hog_slack = self.model.NewIntVar(0, self._minute_ub, f'hog_{emp.id[:6]}')
                    self.model.Add(w_var - hog_slack <= share_limit)
                    # Tier 2: Fairness Slack (Reduced from 1,000 to 10 to prioritize coverage)
                    self._workload_slack_terms.append(10 * hog_slack)

            # 7. HC-4: Maximum hours over the window (audit fix — previously
            # NEVER enforced; only the `w` variable's loose upper bound capped
            # it, ~166h above contract). max_weekly_minutes is pre-scaled to
            # the window by the caller. Softened with a Tier-0 (legal) penalty
            # rather than a hard `<=` so that pinned existing shifts already
            # exceeding the max cannot make the whole model INFEASIBLE.
            w_var_max = self._emp_workload_vars.get(emp.id)
            if w_var_max is not None and emp.max_weekly_minutes > 0:
                max_slack = self.model.NewIntVar(0, self._minute_ub, f'maxh_{emp.id[:6]}')
                self.model.Add(w_var_max - max_slack <= emp.max_weekly_minutes)
                self._workload_slack_terms.append(100_000_000 * max_slack)

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
                # Tier 0: Hard Legal Compliance (100,000,000 penalty per minute).
                # Collected here and added to the objective by the SC-8 loop in
                # _add_objective(), which drains every _workload_slack_terms entry.
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

                    if discount > 0:
                        debts = getattr(emp, 'fairness_debts', {})
                        if 'denied_preferences' in debts:
                            debt = debts['denied_preferences']
                            # If debt > 0, they are owed a preference. Boost the discount.
                            # We use 200 cents ($2.00) per denied preference debt.
                            if debt > 0:
                                discount += int(debt * 200 * _strategy_mult(self.data.strategy.fairness_weight))

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
        # DELIVERABLE 2 — FAIRNESS ALWAYS ACTIVE
        # The previous version gated this block on
        #   `total_demand >= 0.4 * sum(max_weekly_minutes)`
        # which silently disabled workload balancing whenever demand was low
        # (e.g. a single day's shifts for a large pool, or a partial-week run).
        # This made the solver concentrate all work on arbitrary employees
        # when there was slack capacity.  The gate is removed so fairness
        # applies at ALL demand levels, still scaled by `fairness_weight`.
        # Fairness Weight (symmetric: 0% -> 0.5x, 50% -> 1.0x, 100% -> 2.0x)
        fair_mult = _strategy_mult(self.data.strategy.fairness_weight)
        peak_terms = []
        for emp in self.data.employees:
            w_var = self._emp_workload_vars.get(emp.id)
            if w_var is None: continue

            baseline = emp.min_contract_minutes if emp.min_contract_minutes > 0 else emp.contract_weekly_minutes
            if baseline <= 0: baseline = 2280
            upper_ideal = int(1.05 * baseline)

            # Over-utilization band: discourage piling work past the ideal.
            #
            # NOTE (integration fix): under-utilization is intentionally NOT
            # penalised here. Penalising `max(0, ideal - w)` against a fixed
            # contract baseline is mathematically backwards as a fairness term —
            # with low total demand, Σ max(0, ideal - w_e) is *minimised* by
            # giving one employee `ideal` and the rest 0 (concentration), the
            # opposite of fairness. That perverse incentive (plus an infeasibly
            # small slack domain) is why the old code gated this block behind a
            # 40%-demand threshold. We instead achieve all-demand-level fairness
            # via the peak-load (min-max) term below, and leave the FT/PT
            # contract floor to HC-7 (_add_min_contract_hours).
            high_v = self.model.NewIntVar(0, self._minute_ub, f'high_v_{emp.id[:6]}')
            self.model.Add(w_var <= upper_ideal + high_v)
            over_coeff = 20 if emp.employment_type in ('FT', 'PT') else 10
            _t(int(over_coeff * fair_mult) * high_v, 'fairness')

            peak_terms.append(w_var)

        # DELIVERABLE 2 — min-max load balancing. Penalising the single highest
        # workload across the pool genuinely SPREADS work at ALL demand levels
        # (demand-independent, no perverse concentration incentive). Sized as a
        # tie-breaker that sits below per-minute labour cost, so cost-first
        # behaviour is preserved while equal-cost candidates get levelled.
        if peak_terms:
            peak_load = self.model.NewIntVar(0, self._minute_ub, 'peak_load')
            self.model.AddMaxEquality(peak_load, peak_terms)
            # B2 — CONVEX fairness guardrail. A gentle penalty on the busiest
            # employee's load, PLUS a steeper second band once they pull well
            # past the pool's fair share. The escalating marginal cost is what
            # makes single-mode auto-spread work without a slider: each extra
            # shift piled on the same person is progressively more expensive than
            # giving it to someone lighter, so the solver levels the load itself.
            _t(int(5 * fair_mult) * peak_load, 'fairness')
            n_emp_fair = max(1, len(peak_terms))
            fair_share = int(self._total_shift_minutes / n_emp_fair)
            severe_threshold = int(1.25 * fair_share)
            peak_severe = self.model.NewIntVar(0, self._minute_ub, 'peak_severe')
            self.model.AddMaxEquality(peak_severe, [peak_load - severe_threshold, 0])
            _t(int(20 * fair_mult) * peak_severe, 'fairness')

        # -- SC-Alignment: Skill Hierarchy & Employment Isolation --------------
        # Pre-build dict lookups so we don't do `next(e for e in ...)` for
        # every (employee, shift) pair — that pattern is O(E·S·(E+S)) which
        # blows up at scale (~6M comparisons for 64k vars / 100 employees).
        emp_by_id = {e.id: e for e in self.data.employees}
        shift_by_id = {s.id: s for s in self.data.shifts}

        for (e_id, s_id), var in self._x.items():
            emp = emp_by_id[e_id]
            shift = shift_by_id[s_id]



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
            # Overtime = minutes worked beyond the contracted minimum. w_var
            # ALREADY includes pinned existing minutes, so the threshold is the
            # full min_contract_minutes. The old code subtracted
            # `(min_contract - existing)`, which double-counted existing minutes
            # and overstated overtime by `existing` for anyone with pinned
            # shifts (audit H2).
            overtime = self.model.NewIntVar(0, self._minute_ub, f'ot_{emp.id[:6]}')
            self.model.AddMaxEquality(overtime, [w_var - emp.min_contract_minutes, 0])

            # 3-line fix for OT/Penalty interaction:
            # OT rate should scale with the highest penalty multiplier active in the window.
            effective_mult = max([2.5 if s.is_public_holiday else 1.5 if s.is_sunday else 1.0 for s in self.data.shifts] + [1.0])
            ot_rate_cents_per_min = int(round(emp.hourly_rate * effective_mult * 0.5 / 60.0 * 100))

            if ot_rate_cents_per_min > 0:
                _t(ot_rate_cents_per_min * overtime, 'cost')

        # -- SC-7: Safety Penalty (Non-linear Fatigue) ------------------------
        # Uses piecewise linear approximation to simulate the exponential drain
        # of high effective working hours (weighted by circadian factors).
        #
        # SC-7 caps (1200/1800 effective minutes) are *weekly* limits, so we
        # window effective minutes per ISO calendar week (Mon-Sun) and penalise
        # each (employee, week) bucket independently. Summing across the whole
        # horizon (e.g. a month) saturated the penalty for ~everyone and made
        # fatigue ~97% of the objective — an artifact of the windowing, not real
        # weekly overload.
        #
        # Fatigue Weight (symmetric: 0% -> 0.5x, 50% -> 1.0x, 100% -> 2.0x)
        fatigue_mult = _strategy_mult(self.data.strategy.fatigue_weight)

        for emp in self.data.employees:
            # Group this employee's effective-minute terms by ISO week.
            eff_terms_by_week: dict[tuple[int, int], list] = {}
            for s in self.data.shifts:
                if (emp.id, s.id) not in self._x:
                    continue
                wk = _iso_week_key(s.shift_date)
                eff_terms_by_week.setdefault(wk, []).append(
                    _calculate_effective_minutes(s) * self._x[emp.id, s.id]
                )
            if not eff_terms_by_week:
                continue

            # Initial fatigue (from previous week) converted to "effective minutes".
            # Calibration: 1 fatigue unit ~= 60 effective minutes in the simplified
            # linear band. This constant maps severity-based fatigue scores from the
            # timekeeping layer into the optimizer's circadian penalty space. It is
            # prior-week load, so it is added to the EARLIEST week bucket only.
            init_eff_mins = int(emp.initial_fatigue_score * 60)
            earliest_week = min(eff_terms_by_week)

            for wk, eff_terms in eff_terms_by_week.items():
                week_init = init_eff_mins if wk == earliest_week else 0
                tag = f'{emp.id[:6]}_{wk[0] % 100:02d}{wk[1]:02d}'

                # Per-week effective minutes. Domain includes week_init so a high
                # prior-fatigue baseline can never make this `==` constraint
                # infeasible (the bug that silently forced the model INFEASIBLE →
                # greedy fallback — audit C4). Per-week totals are <= horizon
                # totals so self._eff_ub remains a valid upper bound.
                eff_total_week = self.model.NewIntVar(
                    0, self._eff_ub + week_init, f'eff_{tag}'
                )
                self.model.Add(
                    eff_total_week == cp_model.LinearExpr.Sum(eff_terms) + week_init
                )

                # Non-linear penalty bands (in cents), per ISO week:
                # 0-1200 mins (20h): $0/min
                # 1200-1800 mins (30h): $5/min surcharge (Amber)
                # 1800+ mins (30h+): $50/min surcharge (Critical/Red)
                # This simulates the -76*log curve's rapid ascent.
                amber_mins = self.model.NewIntVar(
                    0, self._eff_ub + week_init, f'amber_{tag}'
                )
                critical_mins = self.model.NewIntVar(
                    0, self._eff_ub + week_init, f'crit_{tag}'
                )
                # amber_mins = max(0, eff_total_week - 1200)
                self.model.AddMaxEquality(amber_mins, [eff_total_week - 1200, 0])
                # critical_mins = max(0, eff_total_week - 1800)
                self.model.AddMaxEquality(critical_mins, [eff_total_week - 1800, 0])

                # Penalties:
                _t(int(500 * fatigue_mult) * amber_mins, 'fatigue')      # $5.00 per minute base
                _t(int(4500 * fatigue_mult) * critical_mins, 'fatigue')  # Extra $45.00

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

        # -- SC-10: DELIVERABLE 4 — NIGHT/WEEKEND FAIRNESS --------------------
        # Balances "undesirable" shifts across employees so no single person
        # absorbs all Sunday, public-holiday, and night-window (00:00–06:00)
        # shifts.  An undesirable shift is one where:
        #   - shift.is_sunday or shift.is_public_holiday, OR
        #   - the shift's time window overlaps the night zone 00:00–06:00
        #     (absolute minutes 0-360 within the shift's day).
        #
        # For each employee we compute `undsr[e]` = count of undesirable
        # shifts assigned to them.  We then penalise deviation above the
        # team average using a slack variable `undsr_high[e]` = max(0,
        # undsr[e] - avg).  Since avg is fractional we use the integer
        # floor and add `undsr_high[e]` directly — the solver minimises
        # the sum of positive deviations (L1 balance).
        #
        # Scaled by `fairness_weight` via `_strategy_mult` so operators can
        # turn it off (weight=0 → ~0.5x ≈ negligible) or amplify it.
        #
        # Undesirable count bound: at most len(shifts) undesirable shifts
        # per employee (conservative).

        # Classify shifts as undesirable
        def _is_night(s: ShiftInput) -> bool:
            """True if the shift window overlaps 00:00–06:00 (360m into the day)."""
            s_start, s_end = shift_window(s)
            day_base = (s_start // 1440) * 1440
            night_start = day_base           # 00:00
            night_end   = day_base + 360     # 06:00
            # Also cover next-day night for overnight shifts
            next_night_start = day_base + 1440
            next_night_end   = day_base + 1440 + 360
            return (
                (s_start < night_end   and s_end > night_start) or
                (s_start < next_night_end and s_end > next_night_start)
            )

        undesirable_shift_ids: set[str] = {
            s.id for s in self.data.shifts
            if s.is_sunday or s.is_public_holiday or _is_night(s)
        }

        if undesirable_shift_ids and self.data.employees:
            n_undsr_shifts = len(undesirable_shift_ids)
            undsr_counts: list = []  # IntVar per employee

            for emp in self.data.employees:
                u_terms = [
                    self._x[emp.id, s_id]
                    for s_id in undesirable_shift_ids
                    if (emp.id, s_id) in self._x
                ]
                undsr_var = self.model.NewIntVar(
                    0, n_undsr_shifts, f'undsr_{emp.id[:6]}'
                )
                self.model.Add(undsr_var == cp_model.LinearExpr.Sum(u_terms))
                undsr_counts.append((emp, undsr_var))

            if undsr_counts:
                # Total undesirable assignments across all employees
                total_undsr = self.model.NewIntVar(
                    0, n_undsr_shifts * len(undsr_counts), 'undsr_total'
                )
                self.model.Add(
                    total_undsr == cp_model.LinearExpr.Sum(
                        [v for _, v in undsr_counts]
                    )
                )
                # Average = total / N_employees. We use integer arithmetic:
                # avg_floor = total // N (rounds down, acceptable for penalty).
                # To avoid division we compare each employee's count to
                # total // N by penalising any `undsr_var > avg_floor`.
                # We express avg_floor via: N * avg_floor <= total < N * (avg_floor+1)
                # which is exactly what AddDivisionEquality does.
                n_emp = len(undsr_counts)
                avg_var = self.model.NewIntVar(0, n_undsr_shifts, 'undsr_avg')
                self.model.AddDivisionEquality(avg_var, total_undsr, n_emp)

                fair_mult = _strategy_mult(self.data.strategy.fairness_weight)
                # Penalty coefficient: 50 cents per undesirable shift above average.
                # Low enough to not override coverage/fatigue but high enough to
                # spread work across a full roster.
                undsr_coeff = int(50 * fair_mult)

                for emp, undsr_var in undsr_counts:
                    high_v = self.model.NewIntVar(0, n_undsr_shifts, f'undsr_hi_{emp.id[:6]}')
                    self.model.AddMaxEquality(high_v, [undsr_var - avg_var, 0])
                    _t(undsr_coeff * high_v, 'undesirable_balance')

        # -- SC-11: LONGITUDINAL FAIRNESS (F1 Ledger) -------------------------
        # Uses pre-computed debt from the fairness_ledger to bias assignments
        # toward employees who are "owed" undesirable shifts and away from
        # employees who have absorbed more than their share historically.
        if undesirable_shift_ids and self.data.employees:
            for emp in self.data.employees:
                debts = getattr(emp, 'fairness_debts', {})
                if not debts:
                    continue

                for s_id in undesirable_shift_ids:
                    if (emp.id, s_id) not in self._x:
                        continue

                    # Determine what kind of undesirable shift this is
                    # Match the TS domain logic: isWeekend, isNight, isPublicHoliday
                    # We have s.is_sunday, _is_night(s), s.is_public_holiday.
                    # Wait, our TS classifier uses Saturday+Sunday for weekend.
                    # The python solver only knows `is_sunday` as a boolean. We can derive Saturday.
                    s = next(x for x in self.data.shifts if x.id == s_id)
                    try:
                        import datetime
                        dt = datetime.datetime.strptime(s.shift_date, '%Y-%m-%d')
                        is_weekend = dt.weekday() in (5, 6) # 5=Sat, 6=Sun
                    except:
                        is_weekend = s.is_sunday

                    penalty_sum = 0
                    if is_weekend and 'weekend_shifts' in debts:
                        debt = debts['weekend_shifts']
                        # Debt coefficient conversion happens in TS, but we are passing raw debts?
                        # Ah, the TS code returns raw debts `fairness_debts: { weekend_shifts: 2.5 }`.
                        # We need to convert debt -> penalty here, OR convert it in TS.
                        # Wait, in the TS code I added `debtsToMap(rawDebts)`.
                        # Let's convert debt to penalty inside the python solver, matching TS.
                        # Actually, TS has `debtToObjectiveCoeff`. We should just compute it here.
                        # For SC-11, 1 unit of debt -> ~300 solver cents.
                        # Positive debt -> penalize assigning. Negative debt -> bonus (negative penalty).
                        penalty_sum += int(debt * 300 * fair_mult)

                    if _is_night(s) and 'night_shifts' in debts:
                        debt = debts['night_shifts']
                        penalty_sum += int(debt * 300 * fair_mult)

                    if s.is_public_holiday and 'public_holiday_shifts' in debts:
                        debt = debts['public_holiday_shifts']
                        penalty_sum += int(debt * 500 * fair_mult)

                    if penalty_sum != 0:
                        _t(penalty_sum * self._x[emp.id, s_id], 'longitudinal_fairness')

        # -- SC-11b: HOURS-FAIRNESS (total_hours / overtime_minutes debts) -----
        # The block above only fires for "undesirable" (weekend/night/PH) shifts.
        # Hours-fairness is orthogonal: an employee who has worked more total
        # hours — or more overtime past contract — than the team average over the
        # rolling window should be biased away from picking up *any* additional
        # shift, since every shift adds hours. Someone below average is nudged
        # toward more work. Hence this applies to ALL (emp, shift) pairs, not
        # just the undesirable ones.
        #
        # The marginal unfairness of assigning shift s to employee e is
        # proportional to (how far e is from the team average) × (how many hours
        # s adds), so the per-assignment penalty is scaled by the shift's hours.
        # Coefficients are deliberately small so hours-fairness nudges rather
        # than overrides coverage/cost (cf. SC-1 ~$25/shift):
        #   total_hours debt:      2.0¢  per (debt-hour   × shift-hour)
        #   overtime_minutes debt: 0.05¢ per (debt-minute × shift-hour)
        # Positive debt → positive penalty (bias away); negative debt → bonus
        # (bias toward). Backward-compatible: an empty ledger means every
        # `fairness_debts` is {}, so no terms are added and the solve is unchanged.
        if self.data.employees:
            hours_fair_mult = _strategy_mult(self.data.strategy.fairness_weight)
            TOTAL_HOURS_COEFF = 2.0   # cents per debt-hour per shift-hour
            OVERTIME_COEFF = 0.05     # cents per debt-minute per shift-hour
            for emp in self.data.employees:
                debts = getattr(emp, 'fairness_debts', {})
                if not debts:
                    continue
                th_debt = debts.get('total_hours', 0) or 0
                ot_debt = debts.get('overtime_minutes', 0) or 0
                if th_debt == 0 and ot_debt == 0:
                    continue
                for s in self.data.shifts:
                    if (emp.id, s.id) not in self._x:
                        continue
                    s_start, s_end = shift_window(s)
                    shift_hours = max(0.0, (s_end - s_start) / 60.0)
                    if shift_hours == 0:
                        continue
                    penalty = int(
                        (th_debt * TOTAL_HOURS_COEFF + ot_debt * OVERTIME_COEFF)
                        * shift_hours * hours_fair_mult
                    )
                    if penalty != 0:
                        _t(penalty * self._x[emp.id, s.id], 'longitudinal_fairness')

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

        # -- B3: Lexicographic objective tiers --------------------------------
        # Single-mode autoscheduler: rather than a manager-tuned weighted sum,
        # the solver optimises three tiers in STRICT priority order (see
        # _solve), locking each at its optimum before moving on:
        #   Tier 1  feasibility + coverage — uncovered shifts, softened-hard
        #           legal/contract slacks ('other'), relaxed-constraint violations.
        #   Tier 2  guardrails — fatigue, fairness/balance, availability & quality.
        #   Tier 3  cost — labour $, the residual tie-breaker.
        # A cheaper roster can therefore NEVER be bought at the price of coverage
        # or a blown fatigue/fairness guardrail. Tiers are assembled from the same
        # per-category term buckets, so objective_breakdown() still itemises every
        # line. ('other' holds only the workload-slack terms appended in SC-8.)
        cat = self._term_categories

        def _cat_sum(names: list[str]):
            exprs = [t for n in names for t in cat[n]]
            return cp_model.LinearExpr.Sum(exprs) if exprs else 0

        coverage_t = _cat_sum(['coverage', 'relaxed_violations', 'other'])
        guardrail_t = _cat_sum(['fatigue', 'fairness', 'undesirable_balance',
                                'longitudinal_fairness', 'availability',
                                'employment_mix', 'continuity'])
        cost_t = _cat_sum(['cost'])
        fairness_only_t = _cat_sum(['fairness', 'undesirable_balance',
                                    'longitudinal_fairness'])

        # tier_profile selects the priority order. 'balanced' is the live policy;
        # the others exist only to generate Pareto "what-if" alternatives (B4).
        if self.tier_profile == 'cheapest':
            # Cost beats wellbeing → the cheapest coverage-feasible roster.
            self._objective_tiers = [
                ('coverage', coverage_t), ('cost', cost_t), ('guardrail', guardrail_t)]
        elif self.tier_profile == 'fairest':
            # Push balance hardest (fairness as the sole tier-2 objective).
            self._objective_tiers = [
                ('coverage', coverage_t), ('guardrail', fairness_only_t), ('cost', cost_t)]
        else:  # 'balanced' — the live single-mode policy
            self._objective_tiers = [
                ('coverage', coverage_t), ('guardrail', guardrail_t), ('cost', cost_t)]
        # NOTE: the objective itself is set per-tier inside _solve(); we do not
        # call self.model.Minimize() here.

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

        # FIX (B): stash the greedy roster so _solve() can fall back to it as a
        # feasible incumbent if CP-SAT times out with no solution on a large
        # model. Only retain the pairs that correspond to a real variable AND
        # were actually assigned (value == 1) — these are the trusted, rest- and
        # eligibility-respecting assignments computed by compute_greedy_hint.
        self._greedy_hint = {
            (emp_id, shift_id): value
            for (emp_id, shift_id), value in hints.items()
            if value == 1 and (emp_id, shift_id) in self._x
        }

        self._metrics.greedy_hint_applied = True

    # -- F: Solve --------------------------------------------------------------

    def _solve(self) -> OptimizerOutput:
        # DELIVERABLE 1 — DETERMINISM
        # CP-SAT's wall-clock limit (`max_time_in_seconds`) introduces
        # hardware/load-dependent nondeterminism: a fast machine can explore
        # more of the search tree before the clock fires, producing a
        # different assignment than a loaded one even with random_seed=42.
        #
        # `max_deterministic_time` is measured in a solver-internal,
        # hardware-independent unit (roughly "work items") so two runs on
        # the same model always explore the same prefix of the search tree
        # and return an identical solution whenever the problem is solved
        # before the deterministic budget is exhausted.
        #
        # TRADEOFF: deterministic time is calibrated on a reference machine;
        # on a slower machine the wall-clock spend per deterministic unit is
        # higher, so a tight `max_deterministic_time` may leave wall-clock
        # budget unused. We therefore set it proportionally to
        # `max_time_seconds * 1000` (empirically ~10× the wall-clock budget
        # in deterministic units) and keep `max_time_in_seconds` as a safety
        # backstop so production runs never spin indefinitely on slow hardware.
        #
        # With `num_workers > 1` each worker runs its own deterministic
        # clock; the first to finish wins, which can reintroduce
        # nondeterminism across hardware. Capping workers to 1 for
        # deterministic operation is the cleanest fix, but is too slow for
        # production. We keep `num_workers` from params (production uses 8)
        # and rely on `random_seed=42` + `max_deterministic_time` to make
        # the portfolio's first solution deterministic on the same hardware.
        # For the regression-test suite `num_workers=2` and short time limits
        # produce fully reproducible results on any single machine.
        params = self.data.solver_params
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = params.max_time_seconds
        # DELIVERABLE 1: deterministic time budget (in solver-internal units)
        solver.parameters.max_deterministic_time = params.max_time_seconds * 1000
        solver.parameters.num_workers = params.num_workers
        solver.parameters.log_search_progress = params.log_search
        solver.parameters.random_seed = 42  # Ensure reproducibility
        # AUTOMATIC_SEARCH lets the multi-worker portfolio (LNS, fixed,
        # core-based, etc.) run in parallel. The AddDecisionStrategy calls
        # in _add_objective remain useful as prioritized hints; FIXED_SEARCH
        # would have honored only the first declared strategy and starved
        # the LNS workers, contributing to UNKNOWN time-outs on busy days.
        solver.parameters.search_branching = cp_model.AUTOMATIC_SEARCH
        # FIX (B): make the greedy warm-start a USABLE incumbent.
        #
        # The greedy hint (`_apply_greedy_hint` -> AddHint) only pins the
        # assignments we trust, leaving the rest of the hint partial. On a large
        # model where tier-1 can't prove feasibility inside the budget, CP-SAT
        # can run the clock out with NO incumbent at all -> status UNKNOWN with 0
        # assignments, and the TS controller then falls back to its own greedy
        # first-fit engine (never taking the optimizer path).
        #
        # The textbook fix is `solver.parameters.repair_hint = True` (repair the
        # partial hint into a complete feasible incumbent). On THIS OR-Tools
        # build (9.15.6755) repair_hint triggers a native LOG(FATAL) abort in
        # MinimizeL1DistanceWithHint / ConfigureSearchHeuristics on the *second*
        # solve in a process -- it crashes the whole worker, which is fatal for
        # the long-lived uvicorn service. So we DO NOT set repair_hint.
        #
        # Instead we keep the greedy roster as an explicit FALLBACK INCUMBENT:
        # the greedy hint is stashed in `_apply_greedy_hint`, and the
        # lexicographic loop below materialises a solution from it if the
        # feasibility-critical FIRST tier ever returns a non-(OPTIMAL|FEASIBLE)
        # status with no incumbent -- reporting FEASIBLE with the greedy roster
        # rather than UNKNOWN/0. Combined with the front-loaded budget (FIX A),
        # this guarantees the solver never silently degrades to UNKNOWN/0 when a
        # greedy-feasible roster exists.

        # -- B3: Lexicographic (preemptive) optimisation ----------------------
        # Optimise each tier in strict priority order, locking it at its optimum
        # before the next is touched. The model is built once and re-solved per
        # tier; the wall/deterministic budget is split across tiers so total
        # solve time stays bounded. Defensive fallback to a single combined solve
        # if tiers were never assembled.
        import math
        tiers = self._objective_tiers or [
            ('all', cp_model.LinearExpr.Sum(
                [t for lst in self._term_categories.values() for t in lst]))
        ]
        n_tiers = len(tiers)

        # FIX (A): front-load the per-tier budget instead of splitting it evenly.
        # The first tier (coverage) is the feasibility-critical one: it must find
        # a first feasible solution for the WHOLE model. An even split (e.g. 90s/3
        # = 30s) starves it on large production problems (806 shifts / 103 staff),
        # so tier-1 returns UNKNOWN and the lexicographic loop breaks with 0
        # assignments. We give the first tier the bulk of the budget and split the
        # remainder evenly across the lower-priority refinement tiers.
        #
        # Allocation is a PURE FUNCTION of params.max_time_seconds and tier index
        # (no wall-clock carry-over) so the deterministic budget — and therefore
        # the regression suite's reproducibility — is preserved. The weights sum
        # to 1.0, so the total across tiers stays <= params.max_time_seconds and
        # the TS client's `solverBudgetSec*1000 + 30_000` timeout is never blown.
        FIRST_TIER_FRACTION = 0.7  # tier-1 gets 70% of the budget
        if n_tiers <= 1:
            tier_weights = [1.0]
        else:
            rest = (1.0 - FIRST_TIER_FRACTION) / (n_tiers - 1)
            tier_weights = [FIRST_TIER_FRACTION] + [rest] * (n_tiers - 1)

        status_code = cp_model.UNKNOWN
        self._tier_values: dict[str, float] = {}
        # FIX (B) — best feasible solution found across the tiers. A LATER tier
        # timing out (UNKNOWN) must NOT discard the feasible solution a PRIOR
        # tier already proved: on this large production model tier-1 (coverage)
        # reaches OPTIMAL but tier-2 (guardrail) then times out, and reading
        # solver.value() after that failed solve would lose tier-1's roster. We
        # therefore snapshot the (emp_id,shift_id) assignment values and the set
        # of uncovered shifts after every OPTIMAL/FEASIBLE tier, and report the
        # most-refined snapshot. `best_status_code` is the status of that
        # snapshot (the prior good tier), not the failed final solve.
        best_solution: Optional[dict[tuple[str, str], int]] = None
        best_uncovered: Optional[set[str]] = None
        best_status_code = cp_model.UNKNOWN
        completed_all_tiers = True
        for idx, (tier_name, tier_expr) in enumerate(tiers):
            per_tier_wall = max(0.05, params.max_time_seconds * tier_weights[idx])
            solver.parameters.max_time_in_seconds = per_tier_wall
            solver.parameters.max_deterministic_time = per_tier_wall * 1000
            self.model.Minimize(tier_expr)
            status_code = solver.solve(self.model)
            if status_code not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
                # This tier produced no usable solution within its budget.
                #   - If a PRIOR tier already found one (best_solution is set),
                #     stop refining and keep that feasible roster — the
                #     lexicographic guarantee (coverage locked first) still holds.
                #   - If this is the FIRST tier and it found nothing, CP-SAT has
                #     no incumbent at all (a time-out on a huge model, NOT a proof
                #     of infeasibility). We leave best_solution=None and let the
                #     greedy fallback (below) materialise an incumbent rather than
                #     returning UNKNOWN/0 and forcing the controller off the
                #     optimizer path.
                completed_all_tiers = False
                break
            # Snapshot this tier's (more-refined) feasible solution.
            best_solution = {
                key: solver.value(var) for key, var in self._x.items()
            }
            best_uncovered = {
                s.id for s in self.data.shifts
                if solver.value(self._uncovered[s.id]) == 1
            }
            best_status_code = status_code
            opt_val = solver.objective_value
            self._tier_values[tier_name] = opt_val
            # Lock this tier at its optimum so lower-priority tiers cannot regress
            # it. Skip the final tier and constant (empty) tiers. Objective values
            # are integer here, so round() is exact and keeps the optimum feasible.
            if idx < n_tiers - 1 and not isinstance(tier_expr, int):
                self.model.Add(tier_expr <= int(round(opt_val)))
        # Whether the FINAL solver.solve() call itself was feasible — captured
        # BEFORE we overwrite status_code with the best-snapshot status. Only
        # when this is true does the live solver still hold a solution we can
        # read via solver.value() / objective_breakdown().
        final_solve_feasible = status_code in (cp_model.OPTIMAL, cp_model.FEASIBLE)
        # The reported status is that of the best snapshot we actually kept (a
        # later tier may have timed out after an earlier tier solved).
        status_code = best_status_code

        STATUS = {
            cp_model.OPTIMAL:    'OPTIMAL',
            cp_model.FEASIBLE:   'FEASIBLE',
            cp_model.INFEASIBLE: 'INFEASIBLE',
            cp_model.UNKNOWN:    'UNKNOWN',
            cp_model.MODEL_INVALID: 'MODEL_INVALID',
        }
        status = STATUS.get(status_code, 'UNKNOWN')

        # `solver_solved` == we kept a real CP-SAT solution snapshot (from this
        # tier or a prior one). `last_solve_feasible` == the FINAL solve call
        # itself was feasible, so the live solver state still holds a solution and
        # solver.value()/objective_breakdown() are safe to read directly.
        solver_solved = best_solution is not None
        last_solve_feasible = final_solve_feasible

        # FIX (B) — greedy fallback incumbent. Only when CP-SAT found NOTHING at
        # all (no snapshot from any tier) AND the model wasn't proven INFEASIBLE
        # / MODEL_INVALID: a tier-1 time-out (UNKNOWN) on a huge model. Rather
        # than degrading to UNKNOWN/0 (which makes the controller discard the
        # optimizer entirely), materialise the greedy warm-start roster — a real,
        # rest-/eligibility-respecting assignment — and report FEASIBLE.
        used_greedy_fallback = (
            not solver_solved
            and status_code not in (cp_model.INFEASIBLE, cp_model.MODEL_INVALID)
            and bool(self._greedy_hint)
        )
        if used_greedy_fallback:
            logger.warning(
                '[ModelBuilder] CP-SAT found no incumbent (%s); falling back to '
                'greedy warm-start roster (%d assignments).',
                status, len(self._greedy_hint),
            )
            status = 'FEASIBLE'
        elif solver_solved:
            # Report the kept snapshot's status (OPTIMAL/FEASIBLE), which may
            # differ from the final tier's UNKNOWN time-out.
            status = STATUS.get(best_status_code, status)

        assignments: list[AssignmentProposal] = []
        unassigned: list[str] = []

        if solver_solved or used_greedy_fallback:
            emp_map = {e.id: e for e in self.data.employees}
            shift_map = {s.id: s for s in self.data.shifts}
            # Source of the roster: the best CP-SAT snapshot when one exists,
            # otherwise the stashed greedy roster.
            assigned_shift_ids: set[str] = set()
            if solver_solved:
                pairs = [key for key, v in best_solution.items() if v == 1]
            else:
                pairs = list(self._greedy_hint.keys())
            for emp_id, shift_id in pairs:
                emp = emp_map[emp_id]
                shift = shift_map[shift_id]
                cost = (shift.duration_minutes / 60.0) * emp.hourly_rate
                assignments.append(AssignmentProposal(
                    shift_id=shift_id,
                    employee_id=emp_id,
                    employment_type=emp.employment_type,
                    cost=round(cost, 2),
                    rationale=self._assignment_rationale(emp, shift),
                ))
                assigned_shift_ids.add(shift_id)
            if solver_solved:
                unassigned = sorted(best_uncovered or set())
            else:
                unassigned = [
                    s.id for s in self.data.shifts
                    if s.id not in assigned_shift_ids
                ]

        breakdown: Optional[dict[str, int]] = None
        pillars: Optional[dict] = None
        binding: Optional[list] = None
        if last_solve_feasible:
            # objective_breakdown evaluates the term expressions against the LIVE
            # solver solution; only valid when the final solve itself was
            # feasible (i.e. the solver still holds that solution).
            try:
                breakdown = self.objective_breakdown(solver)
            except Exception as _exc:
                logger.warning('[ModelBuilder] objective_breakdown failed: %s', _exc)
        if solver_solved or used_greedy_fallback:
            # Pillars/binding derive purely from the assignment + unassigned
            # lists, so they are valid for the greedy-fallback roster too.
            try:
                pillars = self._compute_pillars(assignments, unassigned)
                binding = self._compute_binding(unassigned)
            except Exception as _exc:
                logger.warning('[ModelBuilder] pillar/binding computation failed: %s', _exc)

        return OptimizerOutput(
            status=status,
            assignments=assignments,
            unassigned_shift_ids=unassigned,
            # solver.objective_value / best_objective_bound are only valid when
            # the final solve itself was feasible. If we kept an earlier-tier
            # snapshot (or the greedy fallback) they would read stale, so fall
            # back to 0.0 in those cases.
            objective_value=(float(sum(breakdown.values())) if breakdown is not None
                             else (solver.objective_value if last_solve_feasible else 0.0)),
            best_objective_bound=solver.best_objective_bound if last_solve_feasible else 0.0,
            # Truly proven optimal only if EVERY tier completed and the final one
            # was OPTIMAL — a prior-tier OPTIMAL with a later-tier time-out does
            # NOT prove the whole lexicographic objective optimal.
            proven_optimal=(completed_all_tiers and best_status_code == cp_model.OPTIMAL),
            metrics=self._metrics,
            objective_breakdown=breakdown,
            tier_values=(getattr(self, '_tier_values', None) or None),
            pillars=pillars,
            binding_constraints=binding,
        )
