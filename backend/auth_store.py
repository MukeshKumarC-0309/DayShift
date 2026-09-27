"""The single user's credentials, stored in a file the app owns.

Why a file and not the database: SCHEMA.md deliberately keeps auth out of
SQLite so the `.db` can be backed up, copied and gitignored without anyone
worrying about leaking a credential. That reasoning still holds — and it holds
harder now that `database.snapshot_database()` copies the file on every start.
So credentials live in `auth.json` instead, which is gitignored and written
0600.

Why not `.env` (where the password hash used to live): setup has to *write*
the credentials, and having the app rewrite its own environment file at
runtime is a footgun — it is read at import, edited by hand, and easy to
clobber. A dedicated file the app owns end-to-end avoids that.
"""

from __future__ import annotations

import json
import logging
import os
import re
import secrets
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

import config

logger = logging.getLogger(__name__)

_hasher = PasswordHasher()

USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9._-]{3,32}$")
MIN_PASSCODE_LENGTH = 8

# A throwaway hash used to keep a failed lookup roughly as slow as a real
# verify, so a wrong username and a wrong passcode do not have obviously
# different response times.
_DUMMY_HASH = _hasher.hash("dummy-passcode-for-constant-time-failure")


class CredentialError(ValueError):
    """Raised when a username or passcode fails validation."""


@dataclass
class Credentials:
    """What is stored in auth.json."""

    username: str
    password_hash: str
    jwt_secret: str
    created_at: str
    updated_at: str


def _now() -> str:
    return datetime.now().replace(microsecond=0).isoformat()


def path() -> Path:
    """Where credentials live. Read at call time so tests can redirect it."""
    return config.CREDENTIALS_PATH


def load() -> Credentials | None:
    """Read the stored credentials, or None if setup has not happened."""
    target = path()
    if not target.exists():
        return None
    try:
        raw = json.loads(target.read_text())
        return Credentials(
            username=str(raw["username"]),
            password_hash=str(raw["password_hash"]),
            jwt_secret=str(raw["jwt_secret"]),
            created_at=str(raw.get("created_at", "")),
            updated_at=str(raw.get("updated_at", "")),
        )
    except (OSError, ValueError, KeyError):
        # A corrupt file must not take the app down — but it must not silently
        # grant access either, so it reads as "not configured" and the setup
        # screen refuses to overwrite it (see `save`).
        logger.error("auth.json is unreadable or malformed", exc_info=True)
        return None


def is_configured() -> bool:
    """Whether a username and passcode have been set."""
    return load() is not None


def _write(credentials: Credentials) -> None:
    target = path()
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(asdict(credentials), indent=2)

    # Write via a temp file in the same directory, then replace, so a crash
    # mid-write can never leave a half-written credential file.
    temp = target.with_suffix(".json.tmp")
    temp.write_text(payload)
    os.chmod(temp, 0o600)
    temp.replace(target)


def validate_username(username: str) -> str:
    """Normalise and check a username, or raise CredentialError."""
    cleaned = username.strip()
    if not USERNAME_PATTERN.fullmatch(cleaned):
        raise CredentialError(
            "Username must be 3-32 characters, using letters, digits, dot, "
            "underscore or hyphen."
        )
    return cleaned


def validate_passcode(passcode: str) -> str:
    """Check a passcode, or raise CredentialError."""
    if len(passcode) < MIN_PASSCODE_LENGTH:
        raise CredentialError(
            f"Passcode must be at least {MIN_PASSCODE_LENGTH} characters."
        )
    if len(passcode) > 256:
        raise CredentialError("Passcode must be at most 256 characters.")
    return passcode


def create(username: str, passcode: str) -> Credentials:
    """Perform first-run setup.

    Refuses if credentials already exist, so the setup screen can never be
    used to overwrite them — changing them goes through `update` instead,
    which requires the current passcode.
    """
    if path().exists():
        raise CredentialError("Credentials are already set up.")

    clean_user = validate_username(username)
    validate_passcode(passcode)

    credentials = Credentials(
        username=clean_user,
        password_hash=_hasher.hash(passcode),
        # Prefer an explicitly configured secret so an existing deployment
        # keeps its sessions; otherwise mint one so first run needs no config.
        jwt_secret=config.JWT_SECRET or secrets.token_urlsafe(48),
        created_at=_now(),
        updated_at=_now(),
    )
    _write(credentials)
    logger.info("Credentials created for %r", clean_user)
    return credentials


def verify(username: str, passcode: str) -> bool:
    """Check a username and passcode pair.

    Runs a dummy hash comparison when the username does not match, so the
    failure takes comparable time either way and does not leak which half was
    wrong.
    """
    credentials = load()
    if credentials is None:
        _safe_verify(_DUMMY_HASH, passcode)
        return False

    if username.strip().casefold() != credentials.username.casefold():
        _safe_verify(_DUMMY_HASH, passcode)
        return False

    return _safe_verify(credentials.password_hash, passcode)


def _safe_verify(hashed: str, passcode: str) -> bool:
    try:
        return _hasher.verify(hashed, passcode)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def update(
    current_passcode: str,
    new_username: str | None = None,
    new_passcode: str | None = None,
) -> Credentials:
    """Change the username and/or passcode, given the current passcode."""
    credentials = load()
    if credentials is None:
        raise CredentialError("Nothing is set up yet.")

    if not _safe_verify(credentials.password_hash, current_passcode):
        raise CredentialError("Current passcode is incorrect.")

    if new_username is not None:
        credentials.username = validate_username(new_username)
    if new_passcode is not None:
        validate_passcode(new_passcode)
        credentials.password_hash = _hasher.hash(new_passcode)
        # Rotating the signing secret alongside the passcode invalidates any
        # session opened with the old one — which is the point of changing it.
        credentials.jwt_secret = secrets.token_urlsafe(48)

    credentials.updated_at = _now()
    _write(credentials)
    logger.info("Credentials updated")
    return credentials


def jwt_secret() -> str:
    """Return the signing secret for session tokens.

    An explicit JWT_SECRET in the environment wins, so an existing setup keeps
    working; otherwise the one minted during setup is used.
    """
    if config.JWT_SECRET:
        return config.JWT_SECRET
    credentials = load()
    if credentials is None:
        raise CredentialError("Nothing is set up yet.")
    return credentials.jwt_secret
