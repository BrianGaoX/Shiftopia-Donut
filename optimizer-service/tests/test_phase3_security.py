"""
Phase 3 — security and observability regression tests.

Locks in the production-hardening contract:
  - Auth: dev-bypass, JWT verification, fail-closed, expiry, audience
  - /ready: distinguishes liveness from readiness
  - Rate limit: trips at the configured threshold
  - Correlation IDs: subject from JWT shows up in logs

Run from optimizer-service/:
    docker exec superman-optimizer python -m pytest tests/test_phase3_security.py -v
"""
from __future__ import annotations

import importlib
import os
import time

import jwt
import pytest
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Helpers — reload the security module so each test gets a fresh env config
# ---------------------------------------------------------------------------

def reload_app(env: dict[str, str]):
    """Apply env overrides and reload security + ortools_runner so the
    FastAPI app picks up the new configuration."""
    for k, v in env.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
    import security  # noqa: F401
    importlib.reload(security)
    import ortools_runner
    importlib.reload(ortools_runner)
    return TestClient(ortools_runner.app)


def make_jwt(secret: str, sub: str = 'user-uuid-1', exp_offset: int = 3600,
             aud: str = 'authenticated', extra: dict | None = None) -> str:
    payload = {
        'sub': sub, 'role': 'authenticated', 'aud': aud,
        'exp': int(time.time()) + exp_offset,
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, secret, algorithm='HS256')


@pytest.fixture(autouse=True)
def _restore_security_state():
    """Test isolation guard.

    Every test in this module calls reload_app(), which MUTATES os.environ
    (AUTH_DISABLED, JWT_SECRET, rate limits) and reload()s the `security` +
    `ortools_runner` modules in place. Without teardown the LAST test leaves
    auth ENABLED with a secret set — and because `importlib.reload` re-executes
    into the SAME module dict, every other test module that built a TestClient
    against the shared app (e.g. test_audit_endpoint) then sees auth enabled
    and gets 401s. That made the full suite pass only by collection-order luck.

    Snapshot the env before each test; afterwards restore it and reload both
    modules so module-level config (AUTH_DISABLED, JWT_SECRET, the slowapi
    limiter, the app) returns to the suite baseline.
    """
    import security
    import ortools_runner
    saved_env = dict(os.environ)
    try:
        yield
    finally:
        os.environ.clear()
        os.environ.update(saved_env)
        importlib.reload(security)
        importlib.reload(ortools_runner)


# ---------------------------------------------------------------------------
# /health and /ready
# ---------------------------------------------------------------------------

def test_health_is_unauthenticated():
    """Liveness probe must NOT require auth — k8s polls it before the
    pod has any traffic, and a misconfigured JWT shouldn't kill the pod."""
    client = reload_app({'OPTIMIZER_AUTH_DISABLED': 'true', 'SUPABASE_JWT_SECRET': ''})
    res = client.get('/health')
    assert res.status_code == 200
    assert res.json()['status'] == 'ok'


def test_ready_returns_200_when_dev_bypass_enabled():
    client = reload_app({'OPTIMIZER_AUTH_DISABLED': 'true', 'SUPABASE_JWT_SECRET': ''})
    res = client.get('/ready')
    assert res.status_code == 200
    body = res.json()
    assert body['ready'] is True
    assert body['auth_mode'] == 'dev-bypass'
    assert body['or_tools'] is True


def test_ready_returns_503_when_jwt_misconfigured():
    """Auth on but no secret = misconfigured. /ready must report
    not-ready so k8s stops sending traffic to the pod."""
    client = reload_app({'OPTIMIZER_AUTH_DISABLED': 'false', 'SUPABASE_JWT_SECRET': ''})
    res = client.get('/ready')
    assert res.status_code == 503
    body = res.json()['detail']
    assert body['ready'] is False
    assert body['auth_mode'] == 'misconfigured'


def test_ready_returns_200_when_jwt_configured():
    client = reload_app({
        'OPTIMIZER_AUTH_DISABLED': 'false',
        'SUPABASE_JWT_SECRET': 'a-32-byte-or-longer-secret-for-hs256',
    })
    res = client.get('/ready')
    assert res.status_code == 200
    assert res.json()['auth_mode'] == 'jwt'


# ---------------------------------------------------------------------------
# Auth — JWT verification
# ---------------------------------------------------------------------------

def test_optimize_requires_authorization_header():
    client = reload_app({
        'OPTIMIZER_AUTH_DISABLED': 'false',
        'SUPABASE_JWT_SECRET': 'a-32-byte-or-longer-secret-for-hs256',
    })
    res = client.post('/optimize', json={'shifts': [], 'employees': []})
    assert res.status_code == 401
    assert 'Authorization' in res.json()['detail']


def test_optimize_rejects_malformed_token():
    client = reload_app({
        'OPTIMIZER_AUTH_DISABLED': 'false',
        'SUPABASE_JWT_SECRET': 'a-32-byte-or-longer-secret-for-hs256',
    })
    res = client.post(
        '/optimize',
        json={'shifts': [], 'employees': []},
        headers={'Authorization': 'Bearer not-a-jwt'},
    )
    assert res.status_code == 401


def test_optimize_rejects_expired_token():
    secret = 'a-32-byte-or-longer-secret-for-hs256'
    client = reload_app({
        'OPTIMIZER_AUTH_DISABLED': 'false',
        'SUPABASE_JWT_SECRET': secret,
    })
    expired = make_jwt(secret, exp_offset=-60)
    res = client.post(
        '/optimize',
        json={'shifts': [], 'employees': []},
        headers={'Authorization': f'Bearer {expired}'},
    )
    assert res.status_code == 401
    assert 'expired' in res.json()['detail'].lower()


def test_optimize_rejects_token_with_wrong_secret():
    client = reload_app({
        'OPTIMIZER_AUTH_DISABLED': 'false',
        'SUPABASE_JWT_SECRET': 'a-32-byte-or-longer-secret-for-hs256',
    })
    forged = make_jwt('attacker-secret-must-be-32-bytes-too')
    res = client.post(
        '/optimize',
        json={'shifts': [], 'employees': []},
        headers={'Authorization': f'Bearer {forged}'},
    )
    assert res.status_code == 401


def test_optimize_rejects_token_with_wrong_audience():
    secret = 'a-32-byte-or-longer-secret-for-hs256'
    client = reload_app({
        'OPTIMIZER_AUTH_DISABLED': 'false',
        'SUPABASE_JWT_SECRET': secret,
        'SUPABASE_JWT_AUDIENCE': 'authenticated',
    })
    bad_aud = make_jwt(secret, aud='attacker')
    res = client.post(
        '/optimize',
        json={'shifts': [], 'employees': []},
        headers={'Authorization': f'Bearer {bad_aud}'},
    )
    assert res.status_code == 401


def test_optimize_accepts_valid_token():
    secret = 'a-32-byte-or-longer-secret-for-hs256'
    client = reload_app({
        'OPTIMIZER_AUTH_DISABLED': 'false',
        'SUPABASE_JWT_SECRET': secret,
    })
    token = make_jwt(secret)
    # Empty shifts payload triggers the 400 validation, but auth has
    # passed by then — that's what we're testing here.
    res = client.post(
        '/optimize',
        json={'shifts': [], 'employees': []},
        headers={'Authorization': f'Bearer {token}'},
    )
    assert res.status_code == 400  # auth passed, body validation failed
    assert 'shifts' in res.json()['detail']


def test_optimize_503_when_secret_missing_in_prod_mode():
    """Fail-closed posture: if AUTH_DISABLED=false and the secret is
    unset, every request must return 503 (not just unauthenticated
    ones). This prevents a pod from silently accepting all requests
    after a misconfiguration."""
    client = reload_app({
        'OPTIMIZER_AUTH_DISABLED': 'false',
        'SUPABASE_JWT_SECRET': '',
    })
    res = client.post(
        '/optimize',
        json={'shifts': [], 'employees': []},
        headers={'Authorization': 'Bearer anything'},
    )
    assert res.status_code == 503


# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------

def test_rate_limit_trips_after_threshold():
    """Hammering /optimize past the per-IP limit must produce 429."""
    client = reload_app({
        'OPTIMIZER_AUTH_DISABLED': 'true',
        # Tighten to a low limit so the test runs fast
        'OPTIMIZER_RATE_OPTIMIZE': '3/minute',
    })
    # First 3 requests get through (will 400 due to empty body, but
    # auth + rate limit both pass).
    for _ in range(3):
        res = client.post('/optimize', json={'shifts': [], 'employees': []})
        assert res.status_code == 400  # body validation, auth ok, not rate-limited yet

    # 4th request gets 429 from slowapi.
    res = client.post('/optimize', json={'shifts': [], 'employees': []})
    assert res.status_code == 429


# ---------------------------------------------------------------------------
# Correlation IDs include JWT subject
# ---------------------------------------------------------------------------

def test_correlation_log_includes_jwt_subject(caplog):
    """When a JWT is provided, the request log line includes the
    subject (truncated to 8 chars). Critical for triage — lets us
    correlate a user's bug report with the exact log entries."""
    secret = 'a-32-byte-or-longer-secret-for-hs256'
    client = reload_app({
        'OPTIMIZER_AUTH_DISABLED': 'false',
        'SUPABASE_JWT_SECRET': secret,
    })
    token = make_jwt(secret, sub='abc123def-rest-of-uuid')

    with caplog.at_level('INFO'):
        client.post(
            '/optimize',
            json={'shifts': [], 'employees': []},
            headers={'Authorization': f'Bearer {token}', 'X-Request-ID': 'test-trace'},
        )

    # The "[optimize] Raw request body received" log line should include
    # the truncated sub. (Test runs in TestClient so we can capture
    # caplog from the logger.)
    matched = [r for r in caplog.records if 'sub=abc123de' in r.getMessage()]
    assert matched, 'expected a log line tagged with sub=abc123de'
