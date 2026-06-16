"""
Shared pytest fixtures for the AutoScheduler optimizer service.

Run from the `optimizer-service/` directory:
    pytest                     # all tests
    pytest tests/test_solver.py -v
    pytest -k "penalty"        # name filter
    pytest --co -q             # list test ids without running

The fixtures produce minimal, focused inputs — enough to exercise one
constraint at a time. If a regression slips in, the failing test will
identify the constraint family within seconds.
"""
from __future__ import annotations

import os
import sys

import pytest

# Make the model_builder importable from the tests/ subdirectory.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from model_builder import (  # noqa: E402
    AvailabilitySlotInput,
    EmployeeInput,
    ExistingShiftInput,
    OptimizerConstraints,
    OptimizerInput,
    ScheduleModelBuilder,
    ShiftInput,
    SolverParameters,
    StrategyInput,
)


# ---------------------------------------------------------------------------
# Builder helpers — concise factories so each test reads as a problem
# statement, not a wall of boilerplate.
# ---------------------------------------------------------------------------

def make_shift(
    sid: str = "s1",
    date: str = "2026-05-15",
    start: str = "09:00",
    end: str = "17:00",
    *,
    role_id: str | None = "role-A",
    priority: int = 1,
    duration_minutes: int | None = None,
    level: int = 0,
    is_training: bool = False,
    target_employment_type: str | None = None,
) -> ShiftInput:
    if duration_minutes is None:
        sh, sm = map(int, start.split(":"))
        eh, em = map(int, end.split(":"))
        mins = (eh * 60 + em) - (sh * 60 + sm)
        if mins <= 0:
            mins += 1440
        duration_minutes = mins
    return ShiftInput(
        id=sid, shift_date=date, start_time=start, end_time=end,
        duration_minutes=duration_minutes, role_id=role_id,
        priority=priority, level=level, is_training=is_training,
        target_employment_type=target_employment_type,
    )


def make_employee(
    eid: str = "e1",
    *,
    employment_type: str = "FT",
    hourly_rate: float = 25.65,
    min_contract_minutes: int = 0,
    max_weekly_minutes: int = 2400,
    level: int = 0,
    is_student: bool = False,
    visa_limit: int = 2880,
    contracted_role_ids: list[str] | None = None,
    skill_ids: list[str] | None = None,
    license_ids: list[str] | None = None,
    existing_shifts: list[ExistingShiftInput] | None = None,
    availability_slots: list[AvailabilitySlotInput] | None = None,
    has_availability_data: bool = False,
) -> EmployeeInput:
    return EmployeeInput(
        id=eid, name=f"Emp-{eid}",
        contracted_role_ids=contracted_role_ids or ["role-A"],
        employment_type=employment_type, hourly_rate=hourly_rate,
        min_contract_minutes=min_contract_minutes,
        max_weekly_minutes=max_weekly_minutes,
        level=level, is_student=is_student, visa_limit=visa_limit,
        skill_ids=skill_ids or [], license_ids=license_ids or [],
        existing_shifts=existing_shifts or [],
        availability_slots=availability_slots or [],
        has_availability_data=has_availability_data,
    )


def solve(
    shifts: list[ShiftInput],
    employees: list[EmployeeInput],
    *,
    constraints: OptimizerConstraints | None = None,
    strategy: StrategyInput | None = None,
    max_time_seconds: float = 5.0,
):
    """Build + solve, return the OptimizerOutput.

    Tests should assert on `output.status`, `output.assignments`, and
    `output.metrics`. Five-second budget is plenty for these micro-cases.
    """
    data = OptimizerInput(
        shifts=shifts, employees=employees,
        constraints=constraints or OptimizerConstraints(
            min_rest_minutes=600,
            enforce_role_match=False,
            enforce_skill_match=False,
            allow_partial=True,
            relax_constraints=False,
        ),
        strategy=strategy or StrategyInput(),
        solver_params=SolverParameters(
            max_time_seconds=max_time_seconds,
            num_workers=2,
            enable_greedy_hint=True,
            log_search=False,
        ),
    )
    return ScheduleModelBuilder(data).build_and_solve()


# ---------------------------------------------------------------------------
# Common fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def trivial_problem():
    """One shift, one employee, both compatible. Should always solve."""
    return [make_shift()], [make_employee()]
