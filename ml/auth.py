"""JWT authentication — verifies Supabase-issued HS256 JWTs locally (no auth-server round trip)."""

import logging
import os
import time
from typing import Optional

import jwt
from fastapi import Header, HTTPException, status

logger = logging.getLogger(__name__)

# When ML_AUTH_DISABLED=true the dependency becomes a no-op. Use for local dev
# and tests; production deployments MUST have it unset.
def _auth_disabled() -> bool:
    return os.getenv('ML_AUTH_DISABLED', '').lower() in ('1', 'true', 'yes')


def _jwt_secret() -> str:
    secret = os.getenv('ML_JWT_SECRET') or os.getenv('SUPABASE_JWT_SECRET')
    if not secret:
        raise RuntimeError(
            "ML_JWT_SECRET (or SUPABASE_JWT_SECRET) is required when auth is enabled. "
            "Set ML_AUTH_DISABLED=true to bypass for local dev."
        )
    return secret


def verify_jwt(authorization: Optional[str] = Header(default=None)) -> dict:
    """FastAPI dependency. Returns the decoded JWT claims; raises 401 on invalid or missing token.
    Bypassed entirely when ML_AUTH_DISABLED=true."""
    if _auth_disabled():
        return {'sub': 'auth-disabled', 'role': 'service_role'}

    if not authorization or not authorization.lower().startswith('bearer '):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='Missing or malformed Authorization header (expected "Bearer <jwt>")',
            headers={'WWW-Authenticate': 'Bearer'},
        )

    token = authorization.split(' ', 1)[1].strip()

    try:
        # Supabase uses HS256 with the project JWT secret. Audience is 'authenticated'
        # for end-user tokens and 'service_role' for backend service tokens — we accept both.
        claims = jwt.decode(
            token,
            _jwt_secret(),
            algorithms=['HS256'],
            audience=['authenticated', 'service_role'],
            options={'require': ['exp', 'sub']},
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail='Token expired')
    except jwt.InvalidAudienceError:
        raise HTTPException(status_code=401, detail='Invalid token audience')
    except jwt.InvalidTokenError as exc:
        logger.warning("JWT verification failed: %s", exc)
        raise HTTPException(status_code=401, detail=f'Invalid token: {exc}')

    # Defensive: PyJWT already enforces exp via decode, but double-check in case
    # of clock skew configuration changes.
    if claims.get('exp', 0) < time.time():
        raise HTTPException(status_code=401, detail='Token expired')

    return claims
