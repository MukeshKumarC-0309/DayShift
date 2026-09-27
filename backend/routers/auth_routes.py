"""Setup, login, logout and session status for the single-user gate.

First run has no credentials, so `/setup` is open — but only until it
succeeds. After that it returns 409 and changing the username or passcode goes
through `/credentials`, which requires the current passcode.
"""

from __future__ import annotations

import logging
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

import auth_store
import config
from auth import (
    clear_session_cookie,
    create_session_token,
    login_throttled,
    record_failed_attempt,
    require_auth,
    reset_attempts,
    set_session_cookie,
    verify_credentials,
)
from schemas import AuthStatus, CredentialUpdate, LoginRequest, SetupRequest

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _status(request: Request) -> AuthStatus:
    credentials = auth_store.load()
    if credentials is None:
        return AuthStatus(
            configured=False,
            authenticated=False,
            setup_token_required=bool(config.SETUP_TOKEN),
        )
    try:
        username = require_auth(request)
    except HTTPException:
        return AuthStatus(configured=True, authenticated=False)
    return AuthStatus(configured=True, authenticated=True, username=username)


@router.get("/status", response_model=AuthStatus)
def session_status(request: Request) -> AuthStatus:
    """Report setup and session state.

    Unauthenticated is a normal answer here, not an error — the SPA calls this
    on mount to choose between the setup screen, the login screen and the
    dashboard.
    """
    return _status(request)


@router.post("/setup", response_model=AuthStatus, status_code=status.HTTP_201_CREATED)
def setup(payload: SetupRequest, request: Request, response: Response) -> AuthStatus:
    """Create the username and passcode on first run, and sign in.

    Open only while nothing is set up. Once credentials exist this returns 409,
    so it can never be used to reset them from outside the app.
    """
    if auth_store.is_configured():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Already set up. Sign in instead.",
        )

    # When hosted publicly, only someone holding SETUP_TOKEN may claim the
    # credential. compare_digest keeps the check constant-time.
    if config.SETUP_TOKEN and not secrets.compare_digest(
        (payload.setup_token or "").encode(), config.SETUP_TOKEN.encode()
    ):
        logger.warning("Setup attempted with a missing or wrong setup token")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Setup token is missing or incorrect.",
        )

    try:
        credentials = auth_store.create(payload.username, payload.passcode)
    except auth_store.CredentialError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)
        ) from exc

    reset_attempts()
    set_session_cookie(response, create_session_token(credentials.username))
    logger.info("First-run setup completed")
    return AuthStatus(configured=True, authenticated=True, username=credentials.username)


@router.post("/login", response_model=AuthStatus)
def login(payload: LoginRequest, response: Response) -> AuthStatus:
    """Check the username and passcode, and set the session cookie.

    Failures return one generic message so a wrong username and a wrong
    passcode are indistinguishable. Repeated failures are throttled with a 429.
    """
    if not auth_store.is_configured():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Not set up yet.",
        )

    retry_after = login_throttled()
    if retry_after:
        logger.warning("Login throttled; %ss remaining", retry_after)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed attempts. Try again shortly.",
            headers={"Retry-After": str(retry_after)},
        )

    if not verify_credentials(payload.username, payload.passcode):
        record_failed_attempt()
        logger.warning("Failed login attempt for %r", payload.username)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or passcode",
        )

    credentials = auth_store.load()
    assert credentials is not None  # guarded by is_configured above
    reset_attempts()
    set_session_cookie(response, create_session_token(credentials.username))
    logger.info("Login succeeded")
    return AuthStatus(configured=True, authenticated=True, username=credentials.username)


@router.post("/logout", response_model=AuthStatus)
def logout(response: Response) -> AuthStatus:
    """Clear the session cookie. Always succeeds, even with no active session."""
    clear_session_cookie(response)
    return AuthStatus(configured=auth_store.is_configured(), authenticated=False)


@router.put(
    "/credentials", response_model=AuthStatus, dependencies=[Depends(require_auth)]
)
def update_credentials(payload: CredentialUpdate, response: Response) -> AuthStatus:
    """Change the username and/or passcode.

    Requires the current passcode. Changing the passcode rotates the session
    signing secret, so a fresh cookie is issued here and any other session is
    invalidated — which is the point of changing it.
    """
    if payload.username is None and payload.new_passcode is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Nothing to change.",
        )

    try:
        credentials = auth_store.update(
            current_passcode=payload.current_passcode,
            new_username=payload.username,
            new_passcode=payload.new_passcode,
        )
    except auth_store.CredentialError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)
        ) from exc

    set_session_cookie(response, create_session_token(credentials.username))
    return AuthStatus(configured=True, authenticated=True, username=credentials.username)


@router.get("/check", response_model=AuthStatus, dependencies=[Depends(require_auth)])
def protected_check(request: Request) -> AuthStatus:
    """Probe endpoint that 401s when the session is missing or expired."""
    return _status(request)
