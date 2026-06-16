"""
Tests for the /metrics endpoint and the concurrency-cap (semaphore) guard.

Run from optimizer-service/:
    OPTIMIZER_AUTH_DISABLED=true python -m pytest tests/test_metrics.py -v
"""
from __future__ import annotations

import importlib
import os

from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_client() -> TestClient:
    """Return a TestClient for the app with auth disabled."""
    os.environ['OPTIMIZER_AUTH_DISABLED'] = 'true'
    import security
    importlib.reload(security)
    import ortools_runner
    importlib.reload(ortools_runner)
    return TestClient(ortools_runner.app)


# ---------------------------------------------------------------------------
# /metrics endpoint
# ---------------------------------------------------------------------------

class TestMetricsEndpoint:
    def test_metrics_returns_200(self):
        client = _get_client()
        res = client.get('/metrics')
        assert res.status_code == 200

    def test_metrics_content_type_is_prometheus(self):
        client = _get_client()
        res = client.get('/metrics')
        assert 'text/plain' in res.headers['content-type']

    def test_metrics_contains_known_metric_names(self):
        client = _get_client()
        res = client.get('/metrics')
        body = res.text
        # Each metric family must appear in the exposition output
        assert 'optimize_requests_total' in body
        assert 'optimize_solve_seconds' in body
        assert 'optimize_coverage_rate' in body
        assert 'optimize_infeasible_total' in body
        assert 'optimize_unknown_total' in body
        assert 'optimize_in_progress' in body
        assert 'audit_requests_total' in body

    def test_metrics_does_not_require_auth(self):
        """Prometheus scrapers must reach /metrics without a bearer token."""
        os.environ['OPTIMIZER_AUTH_DISABLED'] = 'false'
        os.environ['SUPABASE_JWT_SECRET'] = 'a-32-byte-or-longer-secret-for-hs256'
        import security
        importlib.reload(security)
        import ortools_runner
        importlib.reload(ortools_runner)
        client = TestClient(ortools_runner.app)
        # No Authorization header — must still be 200
        res = client.get('/metrics')
        assert res.status_code == 200
        # Restore dev-bypass for subsequent tests
        os.environ['OPTIMIZER_AUTH_DISABLED'] = 'true'

    def test_audit_increments_counter(self):
        """After a successful /audit call the audit_requests_total counter
        must increase (verifies end-to-end instrumentation wiring)."""
        client = _get_client()

        # Grab baseline
        before = client.get('/metrics').text
        before_count = _extract_counter(before, 'audit_requests_total', 'status="ok"')

        # Trigger one successful audit
        payload = {
            'shifts': [{
                'id': 's1', 'shift_date': '2026-05-15',
                'start_time': '09:00', 'end_time': '17:00',
                'duration_minutes': 480, 'priority': 1,
            }],
            'employees': [{
                'id': 'e1', 'name': 'Alice', 'employment_type': 'FT',
                'hourly_rate': 25.0, 'max_weekly_minutes': 2400,
                'min_contract_minutes': 0,
            }],
            'constraints': {
                'min_rest_minutes': 600, 'relax_constraints': False,
                'enforce_role_match': False, 'enforce_skill_match': False,
                'allow_partial': True,
            },
        }
        audit_res = client.post('/audit', json=payload)
        assert audit_res.status_code == 200

        after = client.get('/metrics').text
        after_count = _extract_counter(after, 'audit_requests_total', 'status="ok"')
        assert after_count > before_count, (
            'audit_requests_total{status="ok"} did not increment after a successful /audit call'
        )


# ---------------------------------------------------------------------------
# Concurrency cap — semaphore guard
# ---------------------------------------------------------------------------

class TestConcurrencyCap:
    def test_semaphore_guard_returns_429_when_saturated(self):
        """When the semaphore is already locked, /optimize must return 429
        immediately instead of queuing indefinitely.

        Strategy: set MAX=1, patch _solve_semaphore so .locked() returns True
        (simulating a solve already in flight), then fire a request and verify
        the 429. We use unittest.mock.patch so the monkeypatch is scoped to
        this test only.
        """
        from unittest.mock import patch, MagicMock

        os.environ['OPTIMIZER_AUTH_DISABLED'] = 'true'
        os.environ['OPTIMIZER_MAX_CONCURRENT_SOLVES'] = '1'
        import security
        importlib.reload(security)
        import ortools_runner
        importlib.reload(ortools_runner)

        client = TestClient(ortools_runner.app)

        # Patch the module-level semaphore so .locked() returns True,
        # simulating a saturated state without touching the event loop.
        mock_sem = MagicMock()
        mock_sem.locked.return_value = True

        with patch.object(ortools_runner, '_solve_semaphore', mock_sem):
            res = client.post(
                '/optimize',
                json={
                    'shifts': [{
                        'id': 's1', 'shift_date': '2026-05-15',
                        'start_time': '09:00', 'end_time': '17:00',
                        'duration_minutes': 480, 'priority': 1,
                    }],
                    'employees': [{
                        'id': 'e1', 'name': 'Alice', 'employment_type': 'FT',
                        'hourly_rate': 25.0, 'max_weekly_minutes': 2400,
                        'min_contract_minutes': 0,
                    }],
                },
            )

        assert res.status_code == 429, (
            f'Expected 429 when semaphore saturated, got {res.status_code}: {res.text}'
        )
        assert 'capacity' in res.json()['detail'].lower()
        os.environ.pop('OPTIMIZER_MAX_CONCURRENT_SOLVES', None)

    def test_semaphore_cap_is_env_configurable(self):
        """OPTIMIZER_MAX_CONCURRENT_SOLVES must be read at module load time."""
        os.environ['OPTIMIZER_AUTH_DISABLED'] = 'true'
        os.environ['OPTIMIZER_MAX_CONCURRENT_SOLVES'] = '5'
        import security
        importlib.reload(security)
        import ortools_runner
        importlib.reload(ortools_runner)

        assert ortools_runner._MAX_CONCURRENT_SOLVES == 5
        # The semaphore's internal value should match
        assert ortools_runner._solve_semaphore._value == 5  # type: ignore[attr-defined]

        os.environ.pop('OPTIMIZER_MAX_CONCURRENT_SOLVES', None)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_counter(text: str, metric: str, label: str) -> float:
    """Parse a single counter value from Prometheus text format.

    Returns 0.0 if the metric line is not yet present (counter not yet
    incremented) so callers can safely compare before/after.
    """
    for line in text.splitlines():
        if line.startswith(metric + '{') and label in line:
            try:
                return float(line.split()[-1])
            except (ValueError, IndexError):
                pass
    return 0.0
