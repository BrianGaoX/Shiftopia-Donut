from __future__ import annotations

from .conftest import make_employee, make_shift, solve
from model_builder import OptimizerConstraints

# Role matching must be ON for these to exercise the role-set eligibility gate;
# conftest.solve() defaults enforce_role_match=False (role/skill off), which
# would let anyone take any shift and make the assertions vacuous.
ROLE_ON = OptimizerConstraints(
    min_rest_minutes=600,
    enforce_role_match=True,
    enforce_skill_match=False,
    allow_partial=True,
    relax_constraints=False,
)


def test_multi_contract_staff_fill_multiple_roles():
    """An employee who holds multiple role contracts can fill shifts requiring
    any of those roles."""
    shifts = [
        make_shift(sid="s1", date="2026-05-15", start="09:00", end="12:00", role_id="role-A"),
        make_shift(sid="s2", date="2026-05-16", start="13:00", end="16:00", role_id="role-B"),
    ]
    employees = [
        make_employee(eid="e1", contracted_role_ids=["role-A", "role-B"]),
    ]

    output = solve(shifts, employees, constraints=ROLE_ON)
    assert output.status in ("OPTIMAL", "FEASIBLE")
    assigned = {a.shift_id for a in output.assignments if a.employee_id == "e1"}
    assert "s1" in assigned
    assert "s2" in assigned


def test_shift_assignments_distribute_fairly():
    """Two equally-qualified (same single role) employees → the two same-role
    shifts split one each rather than piling on one (lexicographic fairness)."""
    shifts = [
        make_shift(sid="s1", date="2026-05-15", start="09:00", end="17:00", role_id="role-A"),
        make_shift(sid="s2", date="2026-05-16", start="09:00", end="17:00", role_id="role-A"),
    ]
    employees = [
        make_employee(eid="e1", contracted_role_ids=["role-A"]),
        make_employee(eid="e2", contracted_role_ids=["role-A"]),
    ]

    output = solve(shifts, employees, constraints=ROLE_ON)
    assert output.status in ("OPTIMAL", "FEASIBLE")
    assert len([a for a in output.assignments if a.employee_id == "e1"]) == 1
    assert len([a for a in output.assignments if a.employee_id == "e2"]) == 1


def test_employee_without_role_is_excluded():
    """Negative case — the core of the fix: an employee who does NOT hold a
    contract for the shift's role cannot be assigned to it (no numeric level
    hierarchy lets them in). With only that employee available, the shift is
    left uncovered."""
    shifts = [make_shift(sid="s1", date="2026-05-15", role_id="role-A")]
    employees = [make_employee(eid="tm_only", contracted_role_ids=["role-B"])]

    output = solve(shifts, employees, constraints=ROLE_ON)
    assert output.status in ("OPTIMAL", "FEASIBLE")
    assert len(output.assignments) == 0
    assert "s1" in output.unassigned_shift_ids


def test_shared_lower_role_distributes_across_holders():
    """The distribution scenario from the design discussion: a multi-role
    employee (TL+TM) and a TM-only employee both hold TM. Two TM shifts must NOT
    all land on the TM-only person — they spread across both TM-holders."""
    shifts = [
        make_shift(sid="tm1", date="2026-05-15", start="09:00", end="17:00", role_id="TM"),
        make_shift(sid="tm2", date="2026-05-16", start="09:00", end="17:00", role_id="TM"),
    ]
    employees = [
        make_employee(eid="multi", contracted_role_ids=["TL", "TM"]),
        make_employee(eid="tm_only", contracted_role_ids=["TM"]),
    ]

    output = solve(shifts, employees, constraints=ROLE_ON)
    assert output.status in ("OPTIMAL", "FEASIBLE")
    assert len(output.assignments) == 2
    holders = {a.employee_id for a in output.assignments}
    assert holders == {"multi", "tm_only"}, (
        f"Shared TM shifts should spread across both TM-holders, got {holders}"
    )
