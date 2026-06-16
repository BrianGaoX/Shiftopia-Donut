"""
Regression tests for every solver-side fix landed during the 2026-05 audit.

Each test is named for the bug it prevents from re-emerging. If any of
these fail, the corresponding architectural decision has regressed and
the AutoScheduler is silently producing wrong schedules again.

Don't relax these tests without updating the audit doc and explaining
why. They are the contract.
"""
from __future__ import annotations

import pytest

from .conftest import make_employee, make_shift, solve
from model_builder import (
    AvailabilitySlotInput,
    ExistingShiftInput,
    OptimizerConstraints,
    StrategyInput,
)


# ---------------------------------------------------------------------------
# Sanity
# ---------------------------------------------------------------------------

def test_trivial_problem_solves(trivial_problem):
    shifts, employees = trivial_problem
    out = solve(shifts, employees)
    assert out.status in ("OPTIMAL", "FEASIBLE")
    assert len(out.assignments) == 1
    assert len(out.unassigned_shift_ids) == 0


# ---------------------------------------------------------------------------
# Spread-of-Hours bug — the one that caused 0 assignments on multi-shift days
# ---------------------------------------------------------------------------

def test_two_shifts_same_day_one_employee_assigns_at_least_one():
    """Regression: spread-of-hours used absolute-since-1970 minutes against
    a [0..2880]-bounded variable, making `v=1` infeasible for any shift on
    a day with another shift in scope. The model returned status=OPTIMAL
    with zero assignments. After the fix (day-relative minutes) the solver
    must place at least one of the two shifts."""
    shifts = [
        make_shift("s1", "2026-05-15", "05:45", "10:00"),
        make_shift("s2", "2026-05-15", "10:30", "14:00"),
    ]
    employees = [make_employee("e1")]
    out = solve(shifts, employees)
    assert out.status in ("OPTIMAL", "FEASIBLE")
    # Same employee, gap = 30m < 600m rest → solver must reject one of the
    # two; assigning both is a rest-gap violation.
    assert len(out.assignments) == 1


def test_overlapping_shifts_distribute_across_employees():
    """Regression: with 3 overlapping morning shifts and 3 employees, a
    correct solver covers all 3. The pre-fix solver returned 0/3 because
    of the spread bug above; this is the production reproducer from the
    user's screenshot."""
    shifts = [
        make_shift("s1", "2026-05-15", "05:45", "14:00"),
        make_shift("s2", "2026-05-15", "06:15", "14:00"),
        make_shift("s3", "2026-05-15", "06:30", "14:00"),
    ]
    employees = [make_employee(f"e{i}") for i in range(1, 4)]
    out = solve(shifts, employees)
    assert out.status in ("OPTIMAL", "FEASIBLE")
    assert len(out.assignments) == 3
    # Each employee should get exactly one shift (no overlap allowed).
    by_emp = {a.employee_id for a in out.assignments}
    assert len(by_emp) == 3


# ---------------------------------------------------------------------------
# Coverage outranks softened constraints (penalty-tier proof)
# ---------------------------------------------------------------------------

def test_coverage_outranks_min_contract_slack():
    """Regression: pre-fix, min_contract_minutes slack at 1e6/min could
    accumulate higher than coverage's 1e7/shift, so the solver chose to
    leave shifts uncovered to satisfy contract-floor slack. Post-fix,
    coverage at 1e8/shift × priority must outrank Tier-1 slack always.

    Setup: an FT employee with a 2000m min-contract obligation but only a
    400m shift available. The solver MUST cover the shift even though
    1600m of min-contract slack is unavoidable. If coverage is correctly
    ranked, the solver assigns; if inverted, it leaves uncovered.
    """
    shifts = [make_shift("s1", "2026-05-15", "09:00", "15:40", duration_minutes=400)]
    employees = [
        make_employee("e1", employment_type="FT", min_contract_minutes=2000),
    ]
    out = solve(shifts, employees)
    assert out.status in ("OPTIMAL", "FEASIBLE")
    assert len(out.assignments) == 1, (
        "Coverage penalty must outrank min-contract slack. If this fails, "
        "the penalty tiers in _add_objective have inverted again."
    )


def test_coverage_outranks_workload_slack():
    """Same principle for HC-4 (workload) slack: coverage > Tier-0 per-shift.
    A single high-priority shift outweighs any plausible Tier-0 slack."""
    shifts = [make_shift("s1", priority=10)]
    employees = [make_employee("e1", min_contract_minutes=5000)]
    out = solve(shifts, employees)
    assert len(out.assignments) == 1, (
        "Priority-10 coverage penalty must outrank workload slack."
    )


def test_strategy_sliders_change_assignment_choice():
    """Regression: confirm the strategy multipliers actually flow through
    to the objective. With two equally-eligible employees at different
    rates, raising cost_weight from 0 to 100 must shift the assignment
    toward the cheaper one.
    """
    shifts = [make_shift("s1")]
    cheap = make_employee("cheap", hourly_rate=20.0)
    expensive = make_employee("expensive", hourly_rate=40.0)

    cost_off = solve([shifts[0]], [cheap, expensive],
                     strategy=StrategyInput(cost_weight=0))
    cost_high = solve([shifts[0]], [cheap, expensive],
                      strategy=StrategyInput(cost_weight=100))
    # With cost_weight=100, solver MUST prefer the cheap employee.
    assert cost_high.assignments[0].employee_id == "cheap"
    # cost_off shouldn't crash and should still cover.
    assert len(cost_off.assignments) == 1


# ---------------------------------------------------------------------------
# Defensive eligibility (Fix #5)
# ---------------------------------------------------------------------------

def test_missing_level_does_not_filter_out_pool():
    """Regression: emp.level=None or shift.level=None used to compare as
    `None < 0` and silently filter every employee. Defensive defaults
    treat missing values as 0 to keep the pool intact."""
    shifts = [make_shift("s1", level=0)]
    e = make_employee("e1")
    e.level = None  # type: ignore[assignment]
    out = solve(shifts, [e])
    assert len(out.assignments) == 1


def test_short_shift_under_180m_still_assignable():
    """Regression: pre-fix, the eligibility filter rejected any shift
    under 180m as 'min engagement' violation. 1-2h training/briefing
    blocks are real and should be schedulable. The post-fix sanity floor
    is 60m."""
    shifts = [make_shift("s1", duration_minutes=90, start="09:00", end="10:30")]
    employees = [make_employee("e1")]
    out = solve(shifts, employees)
    assert len(out.assignments) == 1


# ---------------------------------------------------------------------------
# Availability hard filter (Phase-1 #1 / HC-5d)
# ---------------------------------------------------------------------------

def test_no_availability_records_treated_as_universally_available():
    """Policy: an employee with `has_availability_data=False` (no records
    on file at all) is universally available — treated as 'not yet
    onboarded'. The shift should be assigned."""
    shifts = [make_shift("s1", "2026-05-15", "09:00", "17:00")]
    employees = [make_employee("e1", has_availability_data=False)]
    out = solve(shifts, employees)
    assert len(out.assignments) == 1


def test_declared_availability_covering_shift_allows_assignment():
    """An employee with `has_availability_data=True` and a slot fully
    covering the shift can be assigned."""
    shifts = [make_shift("s1", "2026-05-15", "09:00", "17:00")]
    employees = [
        make_employee(
            "e1",
            has_availability_data=True,
            availability_slots=[
                AvailabilitySlotInput(
                    slot_date="2026-05-15", start_time="08:00", end_time="18:00",
                ),
            ],
        ),
    ]
    out = solve(shifts, employees)
    assert len(out.assignments) == 1


def test_declared_availability_not_covering_shift_blocks_assignment():
    """An employee with declared availability that doesn't cover the
    shift must be hard-rejected; the shift goes uncovered if no other
    candidate is available."""
    shifts = [make_shift("s1", "2026-05-15", "09:00", "17:00")]
    employees = [
        make_employee(
            "e1",
            has_availability_data=True,
            availability_slots=[
                AvailabilitySlotInput(
                    slot_date="2026-05-15", start_time="18:00", end_time="22:00",
                ),
            ],
        ),
    ]
    out = solve(shifts, employees)
    # Solver must NOT place the candidate; shift goes uncovered.
    assert len(out.assignments) == 0
    assert "s1" in out.unassigned_shift_ids


# ---------------------------------------------------------------------------
# Relaxed-violations branch (Fix #3)
# ---------------------------------------------------------------------------

def test_relax_constraints_does_not_raise():
    """Regression: pre-fix, `_add_objective` referenced an undefined
    `self._relaxed_violations` attribute. Toggling Relax Blockers raised
    AttributeError and the run failed end-to-end. The dead branch was
    removed; we now assert the path runs cleanly."""
    shifts = [make_shift("s1")]
    employees = [make_employee("e1")]
    constraints = OptimizerConstraints(
        min_rest_minutes=600, relax_constraints=True,
        enforce_role_match=False, enforce_skill_match=False,
        allow_partial=True,
    )
    out = solve(shifts, employees, constraints=constraints)
    assert out.status in ("OPTIMAL", "FEASIBLE")


# ---------------------------------------------------------------------------
# C1 — Interval-variable refactor (Phase 1)
# ---------------------------------------------------------------------------

def test_interval_vars_drop_constraint_count():
    """The interval-variable refactor cuts constraint count by ~6× vs the
    legacy pairwise approach. We don't want to regress to pairwise and
    silently double the build time again. Threshold is generous to allow
    for new constraint families (workload, spread, etc.)."""
    # 20 overlapping shifts × 10 employees = 200 candidate pairs.
    shifts = [
        make_shift(f"s{i}", "2026-05-15", f"{6 + i:02d}:00", f"{14 + i:02d}:00")
        for i in range(20)
    ]
    employees = [make_employee(f"e{i}") for i in range(10)]
    out = solve(shifts, employees, max_time_seconds=10)
    # Pairwise would emit ~10 employees × C(20,2)=190 pairs × 2 (HC-2 + HC-3)
    # = 3 800 constraints just for overlap+rest. AddNoOverlap emits
    # ~10 (one per employee) + workload/spread/objective overhead.
    # Empirically: ~1 700 with the new model. Set the regression bar at
    # 2 500 — well above current, well below pairwise.
    assert out.metrics.num_constraints < 2500, (
        f"Constraint count {out.metrics.num_constraints} suggests we've "
        f"regressed to pairwise overlap/rest constraints."
    )
    assert out.status in ("OPTIMAL", "FEASIBLE")


# ---------------------------------------------------------------------------
# Horizon-derived variable bounds (audit C3/C4) — the fixed 5000-minute /
# 720-minute caps used to silently force INFEASIBLE or under-assignment.
# ---------------------------------------------------------------------------

def test_high_initial_fatigue_does_not_make_model_infeasible():
    """Regression: `init_eff_mins = initial_fatigue_score * 60` was fed into an
    `eff_total == sum + init` constraint whose var domain was capped at 5000.
    Any initial_fatigue_score > ~83 made that equality unsatisfiable for ANY
    assignment, turning the ENTIRE model INFEASIBLE (→ silent greedy fallback).
    With horizon-derived bounds the model must stay solvable and still cover
    the shift even for an absurdly fatigued employee."""
    shifts = [make_shift("s1", "2026-05-15", "09:00", "17:00")]
    e = make_employee("e1")
    e.initial_fatigue_score = 450.0  # the worst-case artifact value
    out = solve(shifts, [e])
    assert out.status in ("OPTIMAL", "FEASIBLE"), (
        "High initial_fatigue_score must not make the model INFEASIBLE."
    )
    assert len(out.assignments) == 1


def test_multi_week_horizon_solves_and_assigns():
    """Regression: with the old fixed 5000-minute (~83h) accumulator domains,
    a multi-week window of work on one employee could exceed the var domain
    and flip the model INFEASIBLE. A 21-day window of daily shifts on a single
    employee must solve and cover at least most of the work."""
    # 15 consecutive days, one 8h day shift each — ~120h of load, comfortably
    # past the old 5000-minute (~83h) accumulator cap. max_weekly_minutes is
    # set high (as the controller's window-scaling would do for a multi-week
    # run) so HC-4 is NOT the binding constraint — this test isolates the
    # accumulator-bound fix, not the max-hours cap.
    shifts = [
        make_shift(f"s{i}", f"2026-05-{15 + i:02d}", "09:00", "17:00")
        for i in range(15)  # 2026-05-15 .. 2026-05-29
    ]
    employees = [
        make_employee("e1", max_weekly_minutes=10000),
        make_employee("e2", max_weekly_minutes=10000),
    ]
    out = solve(shifts, employees, max_time_seconds=10)
    assert out.status in ("OPTIMAL", "FEASIBLE")
    # The rest gap (600m) easily allows one 8h shift per day, so every shift
    # is coverable across two employees once HC-4 has headroom.
    assert len(out.assignments) == len(shifts)


def test_twelve_hour_plus_day_is_assignable():
    """Regression: day_vars were bounded at 720 (12h). A single 13h shift made
    `day_vars[i] == sum(...)` infeasible, so the solver left it uncovered (or
    the whole day collapsed). A 13h shift must now be assignable."""
    shifts = [make_shift("s1", "2026-05-15", "08:00", "21:00")]  # 13h
    employees = [make_employee("e1")]
    out = solve(shifts, employees)
    assert out.status in ("OPTIMAL", "FEASIBLE")
    assert len(out.assignments) == 1


# ---------------------------------------------------------------------------
# HC-4 maximum weekly hours (audit — was never enforced)
# ---------------------------------------------------------------------------

def test_max_weekly_hours_softly_enforced():
    """Regression: HC-4 (weekly max) was documented as a hard constraint but
    never added to the model — only the `w` var's loose upper bound capped it.
    It is now a Tier-0 softened cap. With a single employee whose max is 480m
    (8h) and 1200m (20h) of *low-priority* coverable work, the solver should
    prefer to leave the excess uncovered rather than blow ~14h past the cap,
    because a priority-1 uncovered shift (1e8) is cheaper than the Tier-0
    max-hours penalty (1e8/min) for every minute over."""
    # Three non-overlapping 8h shifts on different days; one employee, 8h cap.
    shifts = [
        make_shift("s1", "2026-05-15", "09:00", "17:00", priority=1),
        make_shift("s2", "2026-05-16", "09:00", "17:00", priority=1),
        make_shift("s3", "2026-05-17", "09:00", "17:00", priority=1),
    ]
    employees = [make_employee("e1", employment_type="Casual",
                               min_contract_minutes=0, max_weekly_minutes=480)]
    out = solve(shifts, employees)
    assert out.status in ("OPTIMAL", "FEASIBLE")
    # At most one 8h (480m) shift fits under the cap; the Tier-0 penalty makes
    # exceeding it by an entire extra shift more expensive than leaving it
    # uncovered. Pre-fix (no cap), the solver would happily assign all three.
    assert len(out.assignments) <= 1, (
        f"HC-4 max-hours should constrain to ~1 shift, got {len(out.assignments)}. "
        f"The weekly-max cap has regressed to unenforced."
    )


def test_overtime_threshold_uses_full_contract_minimum():
    """Regression (H2): overtime was computed as `w - (min_contract - existing)`,
    double-counting pinned existing minutes (w already includes them). With an
    FT employee who has 1200m of existing shifts and a 2280m contract minimum,
    assigning a fresh 480m shift keeps total (1680m) BELOW the minimum, so
    there must be zero overtime cost. The double-count bug would have charged
    overtime on 1200m of phantom minutes. We assert the run is feasible and
    assigns (a coarse guard that the OT math no longer destabilises cost)."""
    existing = [ExistingShiftInput(
        id="ex1", shift_date="2026-05-14", start_time="09:00", end_time="17:00",
        duration_minutes=480,
    ), ExistingShiftInput(
        id="ex2", shift_date="2026-05-12", start_time="09:00", end_time="17:00",
        duration_minutes=480,
    )]
    e = make_employee("e1", employment_type="FT", min_contract_minutes=2280,
                      existing_shifts=existing)
    shifts = [make_shift("s1", "2026-05-15", "09:00", "17:00")]
    out = solve(shifts, [e])
    assert out.status in ("OPTIMAL", "FEASIBLE")
    assert len(out.assignments) == 1


# ---------------------------------------------------------------------------
# DELIVERABLE 1 — Determinism
# Solves the SAME non-trivial problem twice and asserts identical results.
# ---------------------------------------------------------------------------

def test_deterministic_solve_same_assignments():
    """DELIVERABLE 1: Two solves of the same non-trivial problem must produce
    identical assignment sets (same set of (employee_id, shift_id) pairs).
    max_deterministic_time + random_seed=42 guarantees this on a single machine.
    """
    # Non-trivial: 5 shifts, 4 employees — solver must make choices.
    shifts = [
        make_shift("s1", "2026-05-15", "06:00", "14:00"),
        make_shift("s2", "2026-05-15", "14:00", "22:00"),
        make_shift("s3", "2026-05-16", "06:00", "14:00"),
        make_shift("s4", "2026-05-16", "14:00", "22:00"),
        make_shift("s5", "2026-05-17", "09:00", "17:00"),
    ]
    employees = [make_employee(f"e{i}") for i in range(1, 5)]

    out1 = solve(shifts, employees, max_time_seconds=5.0)
    out2 = solve(shifts, employees, max_time_seconds=5.0)

    assert out1.status in ("OPTIMAL", "FEASIBLE")
    assert out2.status in ("OPTIMAL", "FEASIBLE")

    pairs1 = {(a.employee_id, a.shift_id) for a in out1.assignments}
    pairs2 = {(a.employee_id, a.shift_id) for a in out2.assignments}
    assert pairs1 == pairs2, (
        f"Non-deterministic result: solve 1 gave {sorted(pairs1)}, "
        f"solve 2 gave {sorted(pairs2)}. max_deterministic_time may have "
        f"regressed or random_seed is not being set."
    )


# ---------------------------------------------------------------------------
# DELIVERABLE 2 — Fairness always active
# Two short shifts + 4 identical employees → must go to 2 DIFFERENT employees.
# ---------------------------------------------------------------------------

def test_fairness_always_active_distributes_shifts():
    """DELIVERABLE 2: Fairness must apply even when demand is very low relative
    to capacity (the old gate `total_demand >= 0.4 * capacity` would have
    disabled fairness here).

    Setup: 2 non-overlapping shifts on different days, 4 identical employees
    whose ideal upper_ideal window is NARROW (set via a tiny contract_weekly_minutes
    of 120m = exactly one shift).  With fairness active:
      - Assigning both shifts to ONE employee costs `high_v * 20` (one shift
        above the 1.05x upper ideal of 126m) = 20 * (240-126) = 2280.
      - Spreading to TWO employees costs 0 high_v (each gets 120m <= 126m).
    So fairness must prefer spreading.  Without fairness (old gate behaviour),
    both choices cost the same and the solver may stack arbitrarily.
    """
    shifts = [
        make_shift("s1", "2026-05-15", "09:00", "11:00"),  # 120m
        make_shift("s2", "2026-05-16", "09:00", "11:00"),  # 120m, different day
    ]
    # contract_weekly_minutes = 120 so upper_ideal = 1.05 * 120 = 126m.
    # Assigning two shifts (240m) to one employee incurs high_v penalty.
    employees = []
    for i in range(1, 5):
        e = make_employee(f"e{i}")
        e.contract_weekly_minutes = 120
        employees.append(e)

    out = solve(shifts, employees, max_time_seconds=5.0)
    assert out.status in ("OPTIMAL", "FEASIBLE")
    assert len(out.assignments) == 2, (
        f"Both shifts must be covered, got {len(out.assignments)} assignments."
    )
    assigned_employees = {a.employee_id for a in out.assignments}
    assert len(assigned_employees) == 2, (
        f"Fairness must spread work across 2 different employees, "
        f"but both shifts went to: {assigned_employees}. "
        f"The fairness gate may have been re-introduced (DELIVERABLE 2)."
    )


# ---------------------------------------------------------------------------
# DELIVERABLE 3 — Multi-hire rest gap (480m vs 600m)
# MULTI_HIRE pair at 520m gap: allowed. NORMAL pair at 520m gap: blocked.
# ---------------------------------------------------------------------------

def test_multihire_pair_480_599m_gap_allowed():
    """DELIVERABLE 3: A MULTI_HIRE shift pair with a 520m gap (8h40m) must
    be assignable to a single employee under the 480m multi-hire EBA rule,
    while two NORMAL shifts at the same gap must be blocked (need 600m rest).

    The pair is placed on ADJACENT DAYS on purpose: a 480m multi-hire gap
    cannot occur within a single day without breaching the unrelated 12h
    daily spread-of-hours rule (first-start → last-end ≤ 12h), so a same-day
    pair would leave a shift uncovered regardless of the rest gap. Cross-day
    isolates the rest-gap behaviour (spread-of-hours groups per calendar day).
    """
    # Day 1 shift ends 22:00; Day 2 shift starts 06:40 → gap = 520m (8h40m).
    mh_shifts = [
        make_shift("mh1", "2026-05-15", "14:00", "22:00"),   # ends 05-15 22:00
        make_shift("mh2", "2026-05-16", "06:40", "12:00"),   # starts 05-16 06:40
    ]
    # Patch shift_type to MULTI_HIRE (make_shift doesn't expose it)
    mh_shifts[0].shift_type = 'MULTI_HIRE'
    mh_shifts[1].shift_type = 'MULTI_HIRE'

    employees = [make_employee("e1")]
    out_mh = solve(mh_shifts, employees, max_time_seconds=5.0)
    assert out_mh.status in ("OPTIMAL", "FEASIBLE")
    assert len(out_mh.assignments) == 2, (
        f"MULTI_HIRE pair with 520m cross-day gap should both be assigned to one "
        f"employee, got {len(out_mh.assignments)} assignments. "
        f"The 480m multi-hire rest rule is not being applied."
    )

    # Same gap but NORMAL shifts → must be blocked (need 600m rest).
    normal_shifts = [
        make_shift("n1", "2026-05-15", "14:00", "22:00"),   # ends 05-15 22:00
        make_shift("n2", "2026-05-16", "06:40", "12:00"),   # starts 05-16 06:40
    ]
    # shift_type defaults to NORMAL

    out_norm = solve(normal_shifts, [make_employee("e1")], max_time_seconds=5.0)
    assert out_norm.status in ("OPTIMAL", "FEASIBLE")
    assert len(out_norm.assignments) == 1, (
        f"NORMAL pair with 520m gap (< 600m) must NOT both go to one employee, "
        f"got {len(out_norm.assignments)} assignments. "
        f"The 600m normal rest gap is not being enforced."
    )


# ---------------------------------------------------------------------------
# DELIVERABLE 4 — Night/Weekend Fairness (undesirable_balance)
# ---------------------------------------------------------------------------

def test_night_weekend_fairness_balances_undesirable_shifts():
    """DELIVERABLE 4: With 2 night shifts and 2 Sunday shifts plus 4 employees
    (all equally eligible), the solver must distribute the undesirable shifts
    rather than stacking them all on one employee.  We assert that no single
    employee receives all 4 undesirable shifts.
    """
    # Sunday shifts
    s1 = make_shift("s1", "2026-05-17", "09:00", "17:00")  # Sunday
    s1.is_sunday = True
    s2 = make_shift("s2", "2026-05-17", "17:00", "22:00")  # Sunday
    s2.is_sunday = True
    # Night shifts (overlap 00:00-06:00)
    s3 = make_shift("s3", "2026-05-18", "22:00", "06:00")  # overnight
    s3.duration_minutes = 480
    s4 = make_shift("s4", "2026-05-19", "02:00", "10:00")  # night start
    # 4 identical employees
    employees = [make_employee(f"e{i}") for i in range(1, 5)]

    out = solve([s1, s2, s3, s4], employees, max_time_seconds=5.0)
    assert out.status in ("OPTIMAL", "FEASIBLE")
    # Count undesirable shifts per employee
    from collections import Counter
    undsr_by_emp: Counter = Counter()
    for a in out.assignments:
        if a.shift_id in {"s1", "s2", "s3", "s4"}:
            undsr_by_emp[a.employee_id] += 1
    # No single employee should hold all 4 undesirable shifts if there are >= 2 covered
    covered_undsr = sum(undsr_by_emp.values())
    if covered_undsr >= 2:
        max_per_emp = max(undsr_by_emp.values(), default=0)
        assert max_per_emp < covered_undsr, (
            f"All {covered_undsr} undesirable shifts went to one employee. "
            f"undesirable_balance objective term is not working."
        )
    # Also assert the objective_breakdown includes 'undesirable_balance'
    assert out.objective_breakdown is not None
    assert 'undesirable_balance' in out.objective_breakdown or covered_undsr == 0, (
        "objective_breakdown must include 'undesirable_balance' category."
    )


# ---------------------------------------------------------------------------
# SC-11 — Longitudinal fairness ledger (F1). debt = rolling_value − team_avg;
# positive = over-share (bias away), negative = owed (bias toward).
# ---------------------------------------------------------------------------

def test_sc11_biases_undesirable_shift_toward_owed_employee():
    """With two equally-eligible employees competing for one undesirable (Sunday)
    shift, SC-11 must hand it to the employee the ledger says is OWED (negative
    weekend debt) over the one who has already done MORE than their share
    (positive debt). Also guards the wire-boundary: fairness_debts must reach
    EmployeeInput, else the term silently no-ops."""
    sunday = make_shift("s1", "2026-05-17", "09:00", "17:00")  # 2026-05-17 is a Sunday
    sunday.is_sunday = True

    owed = make_employee("owed")
    owed.fairness_debts = {"weekend_shifts": -3.0}          # done fewer → should win
    overworked = make_employee("overworked")
    overworked.fairness_debts = {"weekend_shifts": 3.0}     # done more → avoid

    out = solve([sunday], [owed, overworked])
    assert out.status in ("OPTIMAL", "FEASIBLE")
    assert len(out.assignments) == 1
    assert out.assignments[0].employee_id == "owed", (
        "SC-11 should bias the undesirable shift toward the owed (negative-debt) "
        "employee. If this fails, fairness_debts was dropped at the wire boundary "
        "or the SC-11 term regressed."
    )
    assert "longitudinal_fairness" in (out.objective_breakdown or {})


def test_sc11_no_effect_on_non_undesirable_shifts():
    """SC-11 only touches undesirable (weekend/night/PH) shifts. A plain weekday
    day shift must still solve and assign regardless of weekend debt (and the
    'longitudinal_fairness' term should not fire)."""
    weekday = make_shift("s1", "2026-05-13", "09:00", "17:00")  # 2026-05-13 is a Wednesday
    e = make_employee("e1")
    e.fairness_debts = {"weekend_shifts": 5.0}
    out = solve([weekday], [e])
    assert out.status in ("OPTIMAL", "FEASIBLE")
    assert len(out.assignments) == 1


# ---------------------------------------------------------------------------
# SC-11b — Hours-fairness (total_hours / overtime_minutes debts). Unlike the
# weekend/night/PH block, this biases *every* shift (any shift adds hours) so an
# over-worked employee is nudged off ordinary weekday work too.
# ---------------------------------------------------------------------------

def test_sc11b_hours_fairness_biases_weekday_shift_toward_under_worked():
    """With two equally-eligible employees competing for one PLAIN WEEKDAY shift
    (which the weekend/night/PH block ignores entirely), the total_hours debt
    must still bias the assignment toward the under-worked (negative-debt)
    employee and away from the over-worked (positive-debt) one. Guards both the
    new SC-11b term and the wire boundary for the total_hours debt."""
    weekday = make_shift("s1", "2026-05-13", "09:00", "17:00")  # 2026-05-13 is a Wednesday

    under = make_employee("under")
    under.fairness_debts = {"total_hours": -40.0}   # worked fewer hours → should win
    over = make_employee("over")
    over.fairness_debts = {"total_hours": 40.0}     # worked more hours → avoid

    out = solve([weekday], [under, over])
    assert out.status in ("OPTIMAL", "FEASIBLE")
    assert len(out.assignments) == 1
    assert out.assignments[0].employee_id == "under", (
        "SC-11b hours-fairness should bias a plain weekday shift toward the "
        "under-worked (negative total_hours debt) employee. If this fails, "
        "fairness_debts.total_hours was dropped at the wire boundary or the "
        "SC-11b term regressed."
    )
    assert "longitudinal_fairness" in (out.objective_breakdown or {})


def test_sc11b_overtime_debt_also_biases_assignment():
    """The overtime_minutes debt feeds the same hours-fairness term. An employee
    deep in positive overtime debt should be avoided in favour of one with
    negative overtime debt, even on an ordinary weekday shift."""
    weekday = make_shift("s1", "2026-05-13", "09:00", "17:00")  # Wednesday

    under = make_employee("under")
    under.fairness_debts = {"overtime_minutes": -1200.0}   # well under → should win
    over = make_employee("over")
    over.fairness_debts = {"overtime_minutes": 1200.0}     # well over → avoid

    out = solve([weekday], [under, over])
    assert out.status in ("OPTIMAL", "FEASIBLE")
    assert len(out.assignments) == 1
    assert out.assignments[0].employee_id == "under"
    assert "longitudinal_fairness" in (out.objective_breakdown or {})


def test_sc11b_no_terms_when_no_hours_debt():
    """Backward-compatibility: an employee with only weekend debt (no
    total_hours/overtime) must not trigger the SC-11b hours term on a plain
    weekday shift — the solve is unchanged and still assigns."""
    weekday = make_shift("s1", "2026-05-13", "09:00", "17:00")  # Wednesday
    e = make_employee("e1")
    e.fairness_debts = {"weekend_shifts": 5.0}   # not an hours metric
    out = solve([weekday], [e])
    assert out.status in ("OPTIMAL", "FEASIBLE")
    assert len(out.assignments) == 1


# ---------------------------------------------------------------------------
# B3 — Single-mode lexicographic objective. Coverage >> guardrails (fatigue /
# fairness) >> cost, optimised in strict priority order. These tests are the
# contract for the "one mode" autoscheduler: a cheaper roster can never be
# bought at the price of a blown guardrail.
# ---------------------------------------------------------------------------

def test_lexicographic_guardrail_outranks_cost():
    """The fairness/fatigue guardrail tier is optimised BEFORE cost, so the
    solver spreads work across the pool even when concentrating it all on the
    cheapest employee would be cheaper. Two far-apart shifts, both coverable by a
    cheap and an expensive employee: a cost-first solver hands both to the cheap
    one; the lexicographic guardrail tier must split them one each."""
    shifts = [
        make_shift("s1", "2026-05-11", "09:00", "17:00"),  # Mon
        make_shift("s2", "2026-05-14", "09:00", "17:00"),  # Thu — days apart, no rest conflict
    ]
    cheap = make_employee("cheap", hourly_rate=20.0)
    expensive = make_employee("expensive", hourly_rate=40.0)

    out = solve(shifts, [cheap, expensive])
    assert out.status in ("OPTIMAL", "FEASIBLE")
    assert len(out.assignments) == 2
    assigned = {a.shift_id: a.employee_id for a in out.assignments}
    assert set(assigned.values()) == {"cheap", "expensive"}, (
        "Lexicographic guardrail tier should spread work across the pool before "
        f"cost is considered; got {assigned}"
    )


def test_lexicographic_coverage_outranks_everything():
    """Coverage is the top tier: every coverable shift must be filled, and cost
    minimisation (bottom tier) can never choose to leave one uncovered to save
    money. One shift, one (expensive) eligible employee → it must still be
    covered."""
    out = solve([make_shift("s1")], [make_employee("pricey", hourly_rate=99.0)])
    assert out.status in ("OPTIMAL", "FEASIBLE")
    assert len(out.assignments) == 1
    assert len(out.unassigned_shift_ids) == 0


# ---------------------------------------------------------------------------
# B5 — transparency payload (pillars + per-assignment rationale). Drives the
# single-mode scorecard and the "why this person" UI.
# ---------------------------------------------------------------------------

def test_b5_pillars_reported_on_solve():
    """Every solve returns a four-pillar scorecard derived from the solution."""
    shifts = [make_shift("s1", "2026-05-11", "09:00", "17:00"),
              make_shift("s2", "2026-05-14", "09:00", "17:00")]
    out = solve(shifts, [make_employee("a"), make_employee("b")])
    assert out.pillars is not None
    p = out.pillars
    assert p["coverage"]["score"] == 100.0
    assert p["cost"]["total"] > 0
    assert 0 <= p["fairness"]["score"] <= 100
    assert 0 <= p["fatigue"]["score"] <= 100
    # Two far-apart shifts, two employees → guardrail spreads one each → perfectly
    # even load → top fairness score.
    assert p["fairness"]["employees_used"] == 2
    assert p["fairness"]["score"] == 100


def test_b5_assignment_rationale_present():
    """Each assignment carries 'why this person' factors."""
    out = solve([make_shift("s1")], [make_employee("cheap", hourly_rate=20.0),
                                     make_employee("pricey", hourly_rate=40.0)])
    assert len(out.assignments) == 1
    r = out.assignments[0].rationale
    assert r is not None
    assert r["eligible_count"] == 2
    assert r["cost_rank"] == 1           # cost tier picks the cheapest eligible
    assert r["cheapest_eligible"] is True


# ---------------------------------------------------------------------------
# B4 — Pareto "what-if" alternatives for the trade-off explorer.
# ---------------------------------------------------------------------------

def test_b4_alternatives_computed_when_requested():
    """With compute_alternatives, the solve returns Pareto corners whose pillar
    scorecards bracket the chosen roster — the cheapest alternative never costs
    more than the balanced one."""
    from model_builder import (
        ScheduleModelBuilder, OptimizerInput, OptimizerConstraints, SolverParameters,
    )
    shifts = [make_shift("s1", "2026-05-11", "09:00", "17:00"),
              make_shift("s2", "2026-05-14", "09:00", "17:00")]
    emps = [make_employee("cheap", hourly_rate=20.0),
            make_employee("pricey", hourly_rate=40.0)]
    data = OptimizerInput(
        shifts=shifts, employees=emps,
        constraints=OptimizerConstraints(enforce_role_match=False, enforce_skill_match=False),
        solver_params=SolverParameters(max_time_seconds=2.0, num_workers=2,
                                       compute_alternatives=True),
    )
    out = ScheduleModelBuilder(data).build_and_solve()
    assert out.alternatives is not None and len(out.alternatives) >= 1
    keys = {a["key"] for a in out.alternatives}
    assert "cheapest" in keys
    cheapest = next(a for a in out.alternatives if a["key"] == "cheapest")
    assert cheapest["pillars"]["cost"]["total"] <= out.pillars["cost"]["total"] + 0.01


# ---------------------------------------------------------------------------
# SC-7 — Wellbeing/fatigue is windowed per ISO calendar week, not horizon-wide.
#
# Bug: `_compute_pillars` and the objective fatigue term summed each employee's
# effective minutes across the ENTIRE optimization horizon (often a month) and
# banded against the 1200/1800 effective-minute SC-7 *weekly* caps. Over a month
# almost everyone exceeded 30h → ~everyone flagged "critical" → wellbeing score
# pinned at 0. Fix: bucket effective minutes per ISO week (Mon-Sun) and band on
# each employee's worst (peak) week, then normalize by headcount.
# ---------------------------------------------------------------------------

def test_fatigue_windowed_per_week_not_pinned_to_zero():
    """A light workload spread over four ISO weeks (~2 short shifts/employee/week,
    well under the weekly cap) must yield a HIGH wellbeing score — NOT 0.

    Pre-fix, the horizon-wide sum of effective minutes over a month tipped most
    people past 1800 (30h) effective minutes and pinned fatigue.score at 0."""
    # Mondays/Tuesdays of four consecutive ISO weeks in 2026 (wk 19-22).
    dates = [
        "2026-05-04", "2026-05-05",  # ISO week 19
        "2026-05-11", "2026-05-12",  # ISO week 20
        "2026-05-18", "2026-05-19",  # ISO week 21
        "2026-05-25", "2026-05-26",  # ISO week 22
    ]
    # 4h day shifts (low circadian weight) — nobody gets near the weekly cap.
    shifts = [make_shift(f"s{i}", d, "09:00", "13:00") for i, d in enumerate(dates)]
    employees = [make_employee(f"e{i}") for i in range(8)]
    out = solve(shifts, employees)
    assert out.status in ("OPTIMAL", "FEASIBLE")
    assert out.pillars["coverage"]["score"] == 100.0
    fat = out.pillars["fatigue"]
    # The whole point of the fix: a reasonable multi-week roster is NOT pinned at 0.
    assert fat["score"] >= 90, (
        f"Light multi-week workload should score high on wellbeing, got {fat}"
    )
    assert fat["critical"] == 0
    assert fat["amber"] == 0


def test_fatigue_single_week_overload_trips_critical():
    """An employee genuinely overloaded WITHIN one ISO week (>30 effective hours)
    must still trip the critical band — the windowing must not hide real weekly
    overwork."""
    # Seven overnight shifts (22:00-06:00) in a single ISO week (2026 wk 23).
    # Each carries heavy circadian weight (~660 effective minutes), so even a
    # few in one week blow past the 1800 (30h effective) critical threshold.
    week = ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04",
            "2026-06-05", "2026-06-06", "2026-06-07"]
    shifts = [make_shift(f"b{i}", d, "22:00", "06:00") for i, d in enumerate(week)]
    # Single eligible employee with a generous weekly cap so the solver can pile
    # the assignable (non-overlapping, rest-gap-respecting) shifts on them.
    employees = [make_employee("solo", max_weekly_minutes=10000)]
    out = solve(shifts, employees)
    assert out.status in ("OPTIMAL", "FEASIBLE")
    fat = out.pillars["fatigue"]
    assert fat["critical"] == 1, (
        f">30h effective in one week must trip critical, got {fat}"
    )
    assert fat["score"] == 0  # only one person used, and they are critical


def test_large_multiweek_never_returns_unknown_zero():
    """Regression (solver budget + greedy fallback): on a LARGE multi-week
    problem solved under a TIGHT budget, the lexicographic solver used to split
    the wall/deterministic budget EVENLY across its 3 tiers, starving the
    feasibility-critical first (coverage) tier so it returned UNKNOWN — the loop
    then broke with ZERO assignments and the controller silently fell back to
    its own greedy engine (the optimizer path was discarded).

    Two fixes guard against that here:
      A. The per-tier budget is front-loaded (first tier gets the majority), so
         coverage has time to find a first feasible solution.
      B. The greedy warm-start is stashed and materialised as a fallback
         incumbent, so even if CP-SAT times out with no incumbent the solver
         reports FEASIBLE with the greedy roster rather than UNKNOWN/0.

    The contract: a large multi-week problem with a coverable (greedy-feasible)
    roster must NEVER return UNKNOWN with 0 assignments. It must return a
    non-UNKNOWN status with len(assignments) > 0.
    """
    # ~30 days, 6 shifts/day = 180 shifts; 40 employees. Deliberately bigger than
    # the micro-cases and run on a tight budget to provoke a tier-1 time-out on
    # slower machines — the path that previously produced UNKNOWN/0.
    shifts = []
    idx = 0
    for day in range(30):  # 2026-05-01 .. 2026-05-30
        date = f"2026-05-{day + 1:02d}"
        for slot in range(6):
            start_h = 6 + slot * 2  # 06,08,10,12,14,16
            shifts.append(
                make_shift(
                    f"s{idx}", date,
                    f"{start_h:02d}:00", f"{start_h + 8:02d}:00"
                    if start_h + 8 <= 23 else "23:00",
                )
            )
            idx += 1
    employees = [
        make_employee(f"e{i}", max_weekly_minutes=10000) for i in range(40)
    ]
    out = solve(shifts, employees, max_time_seconds=8.0)
    assert out.status != "UNKNOWN", (
        f"Large multi-week solve returned UNKNOWN — the per-tier budget split or "
        f"the greedy fallback incumbent has regressed. status={out.status}"
    )
    assert out.status in ("OPTIMAL", "FEASIBLE")
    assert len(out.assignments) > 0, (
        "Large multi-week solve returned 0 assignments while a greedy-feasible "
        "roster exists — the solver silently degraded to the controller's greedy "
        "fallback (the bug this guards)."
    )


def test_fatigue_mixed_roster_produces_gradient():
    """With one overloaded employee in a single week and several light employees,
    the headcount-normalized wellbeing score is a gradient — neither pinned at 0
    nor a perfect 100."""
    # One heavy ISO week (wk 23) of overnight shifts that only `heavy` can take,
    # plus four light day shifts in a different week that the others share.
    heavy_week = ["2026-06-01", "2026-06-02", "2026-06-03",
                  "2026-06-04", "2026-06-05"]
    heavy_shifts = [
        make_shift(f"h{i}", d, "22:00", "06:00", role_id="role-night")
        for i, d in enumerate(heavy_week)
    ]
    light_dates = ["2026-06-15", "2026-06-16", "2026-06-17", "2026-06-18"]
    light_shifts = [
        make_shift(f"l{i}", d, "09:00", "13:00", role_id="role-day")
        for i, d in enumerate(light_dates)
    ]
    heavy = make_employee("heavy", contracted_role_ids=["role-night"],
                          max_weekly_minutes=10000)
    light_emps = [
        make_employee(f"light{i}", contracted_role_ids=["role-day"])
        for i in range(4)
    ]
    # Enforce role matching so only `heavy` can take the night shifts (else
    # fairness spreads them and nobody trips critical).
    out = solve(
        heavy_shifts + light_shifts, [heavy] + light_emps,
        constraints=OptimizerConstraints(
            min_rest_minutes=600, enforce_role_match=True,
            enforce_skill_match=False, allow_partial=True, relax_constraints=False,
        ),
    )
    assert out.status in ("OPTIMAL", "FEASIBLE")
    fat = out.pillars["fatigue"]
    # heavy trips critical; the four light employees do not → score is a gradient.
    assert fat["critical"] >= 1
    assert 0 < fat["score"] < 100, (
        f"Mixed roster should give a graded wellbeing score, got {fat}"
    )


# ---------------------------------------------------------------------------
# Weekly decomposition — month-long rosters are solved one ISO week at a time
# (pinning prior weeks as existing_shifts) so the fairness/cost tiers aren't
# time-starved on one monolithic solve. The contract: cross-week guarantees
# (rest-gap, hour caps, cumulative fairness) MUST survive the decomposition.
# ---------------------------------------------------------------------------

def _solve_decomposed(shifts, employees, *, max_time_seconds=4.0, constraints=None):
    from model_builder import (
        ScheduleModelBuilder, OptimizerInput, OptimizerConstraints, SolverParameters,
    )
    data = OptimizerInput(
        shifts=shifts, employees=employees,
        constraints=constraints or OptimizerConstraints(
            min_rest_minutes=600, enforce_role_match=False, enforce_skill_match=False,
            allow_partial=True, relax_constraints=False,
        ),
        solver_params=SolverParameters(max_time_seconds=max_time_seconds, num_workers=2,
                                       decompose_by_week=True),
    )
    return ScheduleModelBuilder(data).build_and_solve()


def test_decomposition_preserves_cross_week_rest_gap():
    """The headline safety claim. A Sunday-late shift and a Monday-early shift
    sit in DIFFERENT ISO weeks; their gap (240m) violates the 600m rest rule.
    Naive independent per-week solving would happily give both to the only
    eligible employee. Because prior weeks are pinned as existing_shifts, the
    Monday shift is filtered out for that employee — so they are NEVER assigned
    both. (2026-07-05 = Sun, ISO wk 27; 2026-07-06 = Mon, ISO wk 28.)"""
    sun = make_shift("sun", "2026-07-05", "16:00", "22:00")
    mon = make_shift("mon", "2026-07-06", "02:00", "08:00")  # 240m gap < 600m
    emp = make_employee("only")
    out = _solve_decomposed([sun, mon], [emp])
    assert out.status in ("OPTIMAL", "FEASIBLE")
    by_emp: dict[str, set[str]] = {}
    for a in out.assignments:
        by_emp.setdefault(a.employee_id, set()).add(a.shift_id)
    # No employee may hold BOTH the Sunday and the Monday shift.
    assert not any({"sun", "mon"} <= got for got in by_emp.values()), (
        f"Cross-week rest gap violated by decomposition: {by_emp}"
    )


def test_decomposition_covers_multiweek_roster():
    """With ample capacity across two ISO weeks, decomposition still reaches
    full coverage — it must not lose shifts relative to a monolithic solve."""
    shifts = [
        make_shift("w1a", "2026-07-01", "09:00", "13:00"),  # ISO wk 27
        make_shift("w1b", "2026-07-02", "09:00", "13:00"),
        make_shift("w2a", "2026-07-08", "09:00", "13:00"),  # ISO wk 28
        make_shift("w2b", "2026-07-09", "09:00", "13:00"),
    ]
    emps = [make_employee(f"e{i}") for i in range(4)]
    out = _solve_decomposed(shifts, emps)
    assert out.status in ("OPTIMAL", "FEASIBLE")
    assert len(out.assignments) == 4 and not out.unassigned_shift_ids
    # Pillars are computed over the full horizon even in decomposed mode.
    assert out.pillars is not None and out.pillars["coverage"]["score"] == 100.0


def test_excluded_pairs_forbids_candidacy():
    """excluded_pairs drops an (employee, shift) pair from the eligibility map so
    the solver re-homes the shift to a different employee (or leaves it
    uncovered). This is what the controller's compliance-repair loop relies on:
    a pair the compliance engine rejected is excluded, forcing an alternate."""
    from model_builder import (
        ScheduleModelBuilder, OptimizerInput, OptimizerConstraints, SolverParameters,
    )
    shift = make_shift("s1", "2026-07-01", "09:00", "17:00")
    cheap = make_employee("cheap", hourly_rate=20.0)
    pricey = make_employee("pricey", hourly_rate=40.0)

    def run(excluded):
        data = OptimizerInput(
            shifts=[shift], employees=[cheap, pricey],
            constraints=OptimizerConstraints(enforce_role_match=False, enforce_skill_match=False),
            solver_params=SolverParameters(max_time_seconds=3.0, num_workers=2),
            excluded_pairs=excluded,
        )
        return ScheduleModelBuilder(data).build_and_solve()

    base = run([])
    assert base.assignments and base.assignments[0].employee_id == "cheap"

    excl = run([("cheap", "s1")])
    assert excl.assignments and excl.assignments[0].employee_id == "pricey"

    both = run([("cheap", "s1"), ("pricey", "s1")])
    assert len(both.assignments) == 0 and both.unassigned_shift_ids == ["s1"]


def test_decomposition_single_week_falls_back_to_monolithic():
    """<2 ISO weeks → _solve_weekly_decomposition returns None and the normal
    monolithic solve runs. The result must still be a correct full solve
    (proven_optimal can be True here, unlike the multi-week decomposed path)."""
    shifts = [make_shift("a", "2026-07-06", "09:00", "13:00"),  # both ISO wk 28
              make_shift("b", "2026-07-07", "09:00", "13:00")]
    emps = [make_employee("e0"), make_employee("e1")]
    out = _solve_decomposed(shifts, emps)
    assert out.status in ("OPTIMAL", "FEASIBLE")
    assert len(out.assignments) == 2 and not out.unassigned_shift_ids
