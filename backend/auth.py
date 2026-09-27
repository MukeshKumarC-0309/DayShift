"""Single-user gate: username + passcode, then a JWT in an httpOnly cookie.

Still one user — there is no accounts table and no concept of a second person.
The username exists so signing in feels like signing in, and so the credential
can be changed without touching a config file.

Credential storage and checking live in auth_store.py; this module owns the
session token, the cookie, and the login throttle.
"""

from __future__ import annotations

import logging
import time
from collections import deque
from datetime import UTC, datetime, timedelta

import jwt
from fastapi import Depends, HTTPException, Request, Response, status

import auth_store
from config import (
    COOKIE_SECURE,
    JWT_ALGORITHM,
    LOGIN_ATTEMPT_WINDOW_SECONDS,
    LOGIN_MAX_ATTEMPTS,
    SESSION_COOKIE_NAME,
    SESSION_TTL_HOURS,
)

logger = logging.getLogger(__name__)

# Timestamps of recent failed logins. In-process and deliberately not
# persisted: a restart clears it, which is fine for a local single-user app
# where this only exists to stop a stray script grinding the argon2 hash.
_failed_attempts: deque[float] = deque(maxlen=LOGIN_MAX_ATTEMPTS * 4)


def _prune_attempts(now: float) -> None:
    cutoff = now - LOGIN_ATTEMPT_WINDOW_SECONDS
    while _failed_attempts and _failed_attempts[0] < cutoff:
        _failed_attempts.popleft()


def login_throttled() -> int:
    """Seconds until the next login attempt is allowed, or 0 if allowed now."""
    now = time.monotonic()
    _prune_attempts(now)
    if len(_failed_attempts) < LOGIN_MAX_ATTEMPTS:
        return 0
    oldest = _failed_attempts[0]
    return max(1, int(LOGIN_ATTEMPT_WINDOW_SECONDS - (now - oldest)))


def record_failed_attempt() -> None:
    """Note a failed login, for throttling."""
    _failed_attempts.append(time.monotonic())


def reset_attempts() -> None:
    """Clear the failure record after a successful login."""
    _failed_attempts.clear()


def verify_credentials(username: str, passcode: str) -> bool:
    """Check a username and passcode against the stored credentials."""
    return auth_store.verify(username, passcode)


def create_session_token(username: str) -> str:
    """Mint a signed JWT for the user's session."""
    now = datetime.now(UTC)
    payload = {
        "sub": username,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=SESSION_TTL_HOURS)).timestamp()),
    }
    return jwt.encode(payload, auth_store.jwt_secret(), algorithm=JWT_ALGORITHM)


def set_session_cookie(response: Response, token: str) -> None:
    """Attach the session JWT as an httpOnly cookie.

    `Secure` follows COOKIE_SECURE: off for plain http://localhost, on when
    hosted over HTTPS. SameSite=lax is enough because the SPA only issues
    same-origin XHR — through the Vite dev proxy locally, or the Netlify
    /api proxy when hosted.
    """
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        secure=COOKIE_SECURE,
        max_age=SESSION_TTL_HOURS * 3600,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    """Remove the session cookie (logout)."""
    response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")


def require_auth(request: Request) -> str:
    """FastAPI dependency: 401 unless a valid session cookie is present.

    Returns the token subject so route handlers can depend on it explicitly.
    """
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )

    try:
        secret = auth_store.jwt_secret()
    except auth_store.CredentialError:
        # Setup has not happened (or auth.json was deleted): no session can be
        # valid, so every token is rejected rather than trusted by default.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not set up"
        ) from None

    try:
        payload = jwt.decode(token, secret, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired session"
        ) from None
    return str(payload.get("sub", ""))


AuthDep = Depends(require_auth)
