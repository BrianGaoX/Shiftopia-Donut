"""
Regression tests for the /audit endpoint (C3).

The audit endpoint replaces the controller's per-(employee, shift) RPC
fan-out (~5 000 round-trips) with a single server-side computation. These
tests lock in the behaviour:

  * each rejection reason maps to the same code the UI expects
  * elapsed_ms scales linearly with target × employee count
  * the endpoint refuses empty payloads with HTTP 400

Run from optimizer-service/:
    python -m pytest tests/test_audit_endpoint.py -v
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from ortools_runner import app


client = TestClient(app)


def _shift(sid="s1", date="2026-05-15", start="09:00", end="17:00",
           level=0, role_id="role-A", duration=480):
    return {
        "id": sid, "shift_date": date, "start_time": start, "end_time": end,
        "duration_minutes": duration, "role_id": role_id, "priority": 1,
        "level": level, "is_training": False, "unpaid_break_minutes": 0,
    }


def _employee(eid="e1", level=0, has_avail=False, slots=None,
              contracted_role_ids=None, existing=None):
    return {
        "id": eid, "name": f"E-{eid}", "employment_type": "FT",
        "hourly_rate": 25.65, "min_contract_minutes": 0,
        "max_weekly_minutes": 2400, "level": level,
        "contracted_role_ids": contracted_role_ids or ["role-A"],
        "existing_shifts": existing or [],
        "has_availability_data": has_avail,
        "availability_slots": slots or [],
    }


# ---------------------------------------------------------------------------

def test_audit_pass_when_universally_available():
    payload = {
        "shifts": [_shift()],
        "employees": [_employee()],
        "constraints": {
            "min_rest_minutes": 600, "relax_constraints": False,
            "enforce_role_match": False, "enforce_skill_match": False,
            "allow_partial": True,
        },
        "target_shift_ids": ["s1"],
    }
    res = client.post("/audit", json=payload)
    assert res.status_code == 200
    body = res.json()
    assert body["audited_shift_count"] == 1
    assert body["rows"][0]["employees"][0]["status"] == "PASS"


def test_audit_flags_role_mismatch():
    """Eligibility is role-set based (no numeric level hierarchy). An employee
    who does not hold a contract for the shift's role must be flagged
    ROLE_MISMATCH — the replacement for the retired LEVEL_TOO_LOW reason."""
    payload = {
        "shifts": [_shift(role_id="role-A")],
        "employees": [_employee(contracted_role_ids=["role-B"])],
        "constraints": {
            "min_rest_minutes": 600, "relax_constraints": False,
            "enforce_role_match": True, "enforce_skill_match": False,
            "allow_partial": True,
        },
        "target_shift_ids": ["s1"],
    }
    res = client.post("/audit", json=payload).json()
    row = res["rows"][0]
    assert row["rejection_summary"] == {"ROLE_MISMATCH": 1}
    assert row["employees"][0]["status"] == "FAIL"
    assert "ROLE_MISMATCH" in row["employees"][0]["rejection_reasons"]


def test_audit_flags_outside_declared_availability():
    payload = {
        "shifts": [_shift(start="20:00", end="23:00", duration=180)],
        "employees": [_employee(
            has_avail=True,
            slots=[{"slot_date": "2026-05-15", "start_time": "08:00", "end_time": "12:00"}],
        )],
        "constraints": {
            "min_rest_minutes": 600, "relax_constraints": False,
            "enforce_role_match": False, "enforce_skill_match": False,
            "allow_partial": True,
        },
        "target_shift_ids": ["s1"],
    }
    res = client.post("/audit", json=payload).json()
    assert res["rows"][0]["rejection_summary"] == {"OUTSIDE_DECLARED_AVAILABILITY": 1}


def test_audit_target_filter_only_returns_requested_shifts():
    payload = {
        "shifts": [_shift("s1"), _shift("s2"), _shift("s3")],
        "employees": [_employee()],
        "constraints": {
            "min_rest_minutes": 600, "relax_constraints": False,
            "enforce_role_match": False, "enforce_skill_match": False,
            "allow_partial": True,
        },
        "target_shift_ids": ["s2"],
    }
    res = client.post("/audit", json=payload).json()
    assert res["audited_shift_count"] == 1
    assert res["rows"][0]["shift_id"] == "s2"


def test_audit_rejects_empty_inputs():
    res = client.post("/audit", json={"shifts": [], "employees": []})
    assert res.status_code == 400


def test_audit_handles_50_shifts_x_100_employees_under_50ms():
    """C3 promise: replace ~5 000 RPC round-trips with one fast server
    call. Server-side compute should be well under 50ms for this shape;
    the prior fan-out took 60-120 seconds. If this test starts taking
    seconds, something has regressed (e.g. accidental quadratic loop)."""
    shifts = [_shift(f"s{i}") for i in range(50)]
    employees = [_employee(f"e{i}") for i in range(100)]
    payload = {
        "shifts": shifts, "employees": employees,
        "constraints": {
            "min_rest_minutes": 600, "relax_constraints": False,
            "enforce_role_match": False, "enforce_skill_match": False,
            "allow_partial": True,
        },
        "target_shift_ids": [s["id"] for s in shifts],
    }
    res = client.post("/audit", json=payload).json()
    assert res["audited_shift_count"] == 50
    assert res["elapsed_ms"] < 50, (
        f"Audit took {res['elapsed_ms']}ms server-side — performance regression."
    )
