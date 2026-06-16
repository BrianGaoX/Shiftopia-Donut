"""
Phase 3 — production hardening.

Single module that bundles authentication, rate limiting, CORS, and
OpenTelemetry instrumentation for the optimizer service. The runner
imports `install(app)` and gets all of them at once.

Design notes:
  - **Auth** uses Supabase's HS256-signed JWT. The browser already has
    one (via the Supabase JS client); send it as `Authorization: Bearer
    <token>`. The optimizer verifies signature + expiry only — no role
    check (the application server enforces RBAC; the optimizer's only
    requirement is "an authenticated principal made this request").
  - **Dev bypass** — when `OPTIMIZER_AUTH_DISABLED=true`, every request
    is treated as authenticated. Used for local development and the
    pytest TestClient. **Must NOT be set in production.**
  - **Rate limit** is per-principal (JWT `sub`), falling back to client
    IP when the request is unauthenticated. This prevents multiple
    tenants behind the same NAT from sharing a rate-limit bucket.
    Default: 30 optimize / 60 audit per minute. Tunable via env.
  - **CORS** allowlist comes from env. No more `*` defaults.
  - **OpenTelemetry** is no-op when `OTEL_EXPORTER_OTLP_ENDPOINT` is
    unset. Adding a collector later is purely a deploy-time concern.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

import jwt
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

logger = logging.getLogger('optimizer.security')


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

def _env_bool(key: str, default: bool = False) -> bool:
    return os.environ.get(key, str(default)).lower() in ('1', 'true', 'yes')


AUTH_DISABLED = _env_bool('OPTIMIZER_AUTH_DISABLED', False)
JWT_SECRET = os.environ.get('SUPABASE_JWT_SECRET', '').strip()
JWT_AUDIENCE = os.environ.get('SUPABASE_JWT_AUDIENCE', 'authenticated')

CORS_ALLOWLIST = [
    o.strip() for o in os.environ.get(
        'OPTIMIZER_CORS_ORIGINS',
        'http://localhost:8080,http://localhost:5173',
    ).split(',') if o.strip()
]

RATE_OPTIMIZE = os.environ.get('OPTIMIZER_RATE_OPTIMIZE', '30/minute')
RATE_AUDIT = os.environ.get('OPTIMIZER_RATE_AUDIT', '60/minute')

OTEL_ENDPOINT = os.environ.get('OTEL_EXPORTER_OTLP_ENDPOINT', '').strip()


# ---------------------------------------------------------------------------
# Auth dependency
# ---------------------------------------------------------------------------

class AuthContext:
    """Resolved principal — what the request was authenticated as.

    `subject` is the Supabase user UUID; `role` is the JWT `role` claim
    (typically `authenticated`). `dev_bypass=True` indicates auth was
    skipped because OPTIMIZER_AUTH_DISABLED is set — never True in prod.
    """
    def __init__(self, subject: str, role: str, dev_bypass: bool = False):
        self.subject = subject
        self.role = role
        self.dev_bypass = dev_bypass

    def __repr__(self) -> str:
        return f'AuthContext(subject={self.subject!r}, role={self.role!r}, dev_bypass={self.dev_bypass})'


def require_auth(
    authorization: Optional[str] = Header(default=None),
) -> AuthContext:
    """FastAPI dependency: verifies the Supabase JWT and returns the
    authenticated principal. 401 on missing/invalid/expired tokens.

    Usage in route handlers:
        @app.post('/optimize')
        async def optimize(request: Request, auth: AuthContext = Depends(require_auth)):
            ...
    """
    if AUTH_DISABLED:
        return AuthContext(subject='dev-bypass', role='authenticated', dev_bypass=True)

    if not JWT_SECRET:
        # Fail closed — refusing to start an unauthenticated optimizer
        # in production is the correct posture. Operators must either
        # set SUPABASE_JWT_SECRET or explicitly OPTIMIZER_AUTH_DISABLED.
        logger.error('JWT_SECRET not configured and AUTH_DISABLED is False — refusing request')
        raise HTTPException(status_code=503, detail='Optimizer auth misconfigured')

    if not authorization or not authorization.lower().startswith('bearer '):
        raise HTTPException(status_code=401, detail='Missing or malformed Authorization header')

    token = authorization.split(' ', 1)[1].strip()
    try:
        claims = jwt.decode(
            token, JWT_SECRET, algorithms=['HS256'],
            audience=JWT_AUDIENCE,
            options={'require': ['exp', 'sub']},
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail='Token expired')
    except jwt.InvalidAudienceError:
        raise HTTPException(status_code=401, detail='Invalid audience')
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f'Invalid token: {e}')

    return AuthContext(
        subject=str(claims.get('sub')),
        role=str(claims.get('role', 'authenticated')),
    )


# ---------------------------------------------------------------------------
# Rate limiter — per-principal key function
# ---------------------------------------------------------------------------

def _get_rate_limit_key(request: Request) -> str:
    """Rate-limit key: JWT `sub` when present, client IP as fallback.

    Multiple tenants behind the same corporate NAT would otherwise all
    share one IP bucket and starve each other. Extracting the `sub` from
    the bearer token gives us a per-tenant bucket for free.

    This function MUST never raise — slowapi calls it for every request
    and an exception would kill the response. Any decode failure falls
    back to the remote IP silently.
    """
    try:
        auth_header = request.headers.get('Authorization', '')
        if auth_header.lower().startswith('bearer '):
            token = auth_header.split(' ', 1)[1].strip()
            # Decode without verification — we only need the `sub` claim
            # for the bucket key; full verification happens in require_auth.
            claims = jwt.decode(
                token, options={'verify_signature': False},
                algorithms=['HS256'],
            )
            sub = claims.get('sub')
            if sub:
                return f'sub:{sub}'
    except Exception:
        pass  # fall through to IP
    return get_remote_address(request)


limiter = Limiter(key_func=_get_rate_limit_key)


# ---------------------------------------------------------------------------
# Wire-up
# ---------------------------------------------------------------------------

def install(app: FastAPI) -> None:
    """Apply CORS, rate-limit, and OTel instrumentation to the app.

    Idempotent — call once during startup.
    """
    # ── CORS ────────────────────────────────────────────────────────────────
    app.add_middleware(
        CORSMiddleware,
        allow_origins=CORS_ALLOWLIST,
        allow_credentials=True,
        allow_methods=['GET', 'POST'],
        allow_headers=['Content-Type', 'Authorization', 'X-Request-ID'],
    )
    logger.info('CORS allowlist: %s', CORS_ALLOWLIST)

    # ── Rate limiting ───────────────────────────────────────────────────────
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    logger.info(
        'Rate limits — optimize=%s, audit=%s', RATE_OPTIMIZE, RATE_AUDIT,
    )

    # ── OpenTelemetry (no-op when endpoint not configured) ──────────────────
    if OTEL_ENDPOINT:
        try:
            from opentelemetry import trace
            from opentelemetry.sdk.resources import Resource
            from opentelemetry.sdk.trace import TracerProvider
            from opentelemetry.sdk.trace.export import BatchSpanProcessor
            from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
            from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

            resource = Resource(attributes={
                'service.name': os.environ.get('OTEL_SERVICE_NAME', 'superman-optimizer'),
                'service.version': '2.0.0',
            })
            provider = TracerProvider(resource=resource)
            provider.add_span_processor(
                BatchSpanProcessor(OTLPSpanExporter(endpoint=OTEL_ENDPOINT)),
            )
            trace.set_tracer_provider(provider)
            FastAPIInstrumentor.instrument_app(app)
            logger.info('OpenTelemetry enabled — exporting to %s', OTEL_ENDPOINT)
        except Exception:
            # OTel must NEVER bring down a production optimizer. Log and
            # continue with no-op tracing.
            logger.exception('OpenTelemetry setup failed; continuing without tracing')
    else:
        logger.info('OpenTelemetry disabled (OTEL_EXPORTER_OTLP_ENDPOINT not set)')

    # ── Auth posture banner ────────────────────────────────────────────────
    if AUTH_DISABLED:
        logger.warning(
            '⚠ AUTH DISABLED — service accepts unauthenticated requests. '
            'NEVER set OPTIMIZER_AUTH_DISABLED=true in production.',
        )
    elif not JWT_SECRET:
        logger.error(
            '⚠ AUTH MISCONFIGURED — JWT_SECRET unset and AUTH_DISABLED=false. '
            'All requests will receive 503 until SUPABASE_JWT_SECRET is provided.',
        )
    else:
        logger.info('Auth: Supabase JWT (HS256) verification enabled')


# ---------------------------------------------------------------------------
# /ready probe helper
# ---------------------------------------------------------------------------

def readiness_status() -> dict:
    """Return readiness state. Used by the /ready endpoint.

    Distinguishes liveness (`/health` — process is up) from readiness
    (`/ready` — can actually accept traffic). A k8s deployment uses
    /ready as the readinessProbe so traffic isn't routed to a pod
    whose JWT secret is missing.
    """
    or_tools_ok = False
    try:
        from ortools.sat.python import cp_model  # noqa: F401
        or_tools_ok = True
    except ImportError:
        pass

    auth_ok = AUTH_DISABLED or bool(JWT_SECRET)

    ready = or_tools_ok and auth_ok

    return {
        'ready': ready,
        'or_tools': or_tools_ok,
        'auth_configured': auth_ok,
        'auth_mode': 'dev-bypass' if AUTH_DISABLED else ('jwt' if JWT_SECRET else 'misconfigured'),
        'cors_origins_count': len(CORS_ALLOWLIST),
        'otel_enabled': bool(OTEL_ENDPOINT),
        'rate_limits': {'optimize': RATE_OPTIMIZE, 'audit': RATE_AUDIT},
    }
