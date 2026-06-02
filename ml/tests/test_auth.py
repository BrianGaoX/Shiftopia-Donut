import time

import jwt
import pytest
from fastapi import HTTPException

import auth


def _make_token(secret: str, **overrides) -> str:
    claims = {
        'sub': 'user-123',
        'aud': 'authenticated',
        'exp': int(time.time()) + 300,
        'iat': int(time.time()),
    }
    claims.update(overrides)
    return jwt.encode(claims, secret, algorithm='HS256')


def test_auth_disabled_bypasses_verification(monkeypatch):
    monkeypatch.setenv('ML_AUTH_DISABLED', 'true')
    claims = auth.verify_jwt(authorization=None)
    assert claims['role'] == 'service_role'


def test_missing_header_raises_401(monkeypatch):
    monkeypatch.delenv('ML_AUTH_DISABLED', raising=False)
    monkeypatch.setenv('ML_JWT_SECRET', 'test-secret-xyz')
    with pytest.raises(HTTPException) as exc:
        auth.verify_jwt(authorization=None)
    assert exc.value.status_code == 401


def test_malformed_header_raises_401(monkeypatch):
    monkeypatch.delenv('ML_AUTH_DISABLED', raising=False)
    monkeypatch.setenv('ML_JWT_SECRET', 'test-secret-xyz')
    with pytest.raises(HTTPException) as exc:
        auth.verify_jwt(authorization='Basic xyz')
    assert exc.value.status_code == 401


def test_valid_token_returns_claims(monkeypatch):
    monkeypatch.delenv('ML_AUTH_DISABLED', raising=False)
    monkeypatch.setenv('ML_JWT_SECRET', 'test-secret-xyz')
    token = _make_token('test-secret-xyz', sub='user-abc')
    claims = auth.verify_jwt(authorization=f'Bearer {token}')
    assert claims['sub'] == 'user-abc'


def test_expired_token_raises_401(monkeypatch):
    monkeypatch.delenv('ML_AUTH_DISABLED', raising=False)
    monkeypatch.setenv('ML_JWT_SECRET', 'test-secret-xyz')
    token = _make_token('test-secret-xyz', exp=int(time.time()) - 60)
    with pytest.raises(HTTPException) as exc:
        auth.verify_jwt(authorization=f'Bearer {token}')
    assert exc.value.status_code == 401


def test_wrong_signature_raises_401(monkeypatch):
    monkeypatch.delenv('ML_AUTH_DISABLED', raising=False)
    monkeypatch.setenv('ML_JWT_SECRET', 'test-secret-xyz')
    token = _make_token('completely-different-secret')
    with pytest.raises(HTTPException) as exc:
        auth.verify_jwt(authorization=f'Bearer {token}')
    assert exc.value.status_code == 401


def test_wrong_audience_raises_401(monkeypatch):
    monkeypatch.delenv('ML_AUTH_DISABLED', raising=False)
    monkeypatch.setenv('ML_JWT_SECRET', 'test-secret-xyz')
    token = _make_token('test-secret-xyz', aud='wrong-audience')
    with pytest.raises(HTTPException) as exc:
        auth.verify_jwt(authorization=f'Bearer {token}')
    assert exc.value.status_code == 401


def test_service_role_audience_accepted(monkeypatch):
    monkeypatch.delenv('ML_AUTH_DISABLED', raising=False)
    monkeypatch.setenv('ML_JWT_SECRET', 'test-secret-xyz')
    token = _make_token('test-secret-xyz', aud='service_role')
    claims = auth.verify_jwt(authorization=f'Bearer {token}')
    assert claims['aud'] == 'service_role'


def test_missing_secret_raises_runtime(monkeypatch):
    monkeypatch.delenv('ML_AUTH_DISABLED', raising=False)
    monkeypatch.delenv('ML_JWT_SECRET', raising=False)
    monkeypatch.delenv('SUPABASE_JWT_SECRET', raising=False)
    with pytest.raises((RuntimeError, HTTPException)):
        # Either RuntimeError from _jwt_secret() or HTTPException(401) if missing
        # header is checked first; both indicate the unauthenticated path is closed.
        auth.verify_jwt(authorization='Bearer some-token')


# ---- Integration: API endpoints reject unauthenticated requests when auth is on ----

def test_predict_endpoint_rejects_unauthenticated_when_auth_enabled(monkeypatch, valid_api_payload):
    """When ML_AUTH_DISABLED is unset, the predict endpoint must return 401 without a JWT."""
    monkeypatch.delenv('ML_AUTH_DISABLED', raising=False)
    monkeypatch.setenv('ML_JWT_SECRET', 'test-secret-xyz')
    # Build a fresh TestClient so it picks up the env change.
    from fastapi.testclient import TestClient
    import api
    client = TestClient(api.app)
    r = client.post('/predict/demand', json=valid_api_payload)
    assert r.status_code == 401


def test_health_and_metrics_remain_unauthenticated(monkeypatch):
    monkeypatch.delenv('ML_AUTH_DISABLED', raising=False)
    monkeypatch.setenv('ML_JWT_SECRET', 'test-secret-xyz')
    from fastapi.testclient import TestClient
    import api
    client = TestClient(api.app)
    assert client.get('/health').status_code == 200
    assert client.get('/metrics').status_code == 200
