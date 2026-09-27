"""Application configuration.

All tunable values live here (or in the `categories` table) so route logic
never contains magic numbers. Category targets are *seeded* from
DEFAULT_CATEGORIES into the database on first run; after that the database
row is the source of truth and can be edited without touching this file.
"""

from __future__ import annotations

import os
from datetime import date
from pathlib import Path
from typing import Final

from dotenv import load_dotenv

BASE_DIR: Final[Path] = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

# --- Storage -----------------------------------------------------------------

# Where runtime data (database, credentials, backups) lives. Defaults to the
# project root for local use. When hosted, point this at a persistent volume
# (the Dockerfile sets it to /data) or every redeploy wipes your history.
DATA_DIR: Final[Path] = Path(os.getenv("DATA_DIR", str(BASE_DIR))).resolve()
DATA_DIR.mkdir(parents=True, exist_ok=True)

DATABASE_PATH: Final[Path] = DATA_DIR / "dayshift.db"
DATABASE_URL: Final[str] = f"sqlite:///{DATABASE_PATH}"

# The single user's credentials. Deliberately NOT in the database: SCHEMA.md
# keeps auth out of SQLite so the .db can be backed up and gitignored without
# carrying a credential, and startup snapshots copy that file every run.
CREDENTIALS_PATH: Path = DATA_DIR / "auth.json"

# Startup snapshots of the database.
BACKUPS_DIR: Final[Path] = DATA_DIR / "backups"

# How many startup snapshots of the database to keep in backups/.
BACKUP_KEEP: Final[int] = int(os.getenv("BACKUP_KEEP", "10"))

# --- Auth --------------------------------------------------------------------
# The username and passcode are set on first run through the setup screen and
# stored in auth.json (see auth_store.py). There is nothing to configure here.
#
# TO CHANGE THEM: Settings -> Credentials, in the app. Changing the passcode
# also rotates the session signing secret, which signs out any existing
# session. If you are locked out, delete auth.json and the app returns to
# first-run setup — your logged data is untouched, since it lives in the
# database.
#
# JWT_SECRET is optional. Set it to pin the signing secret (sessions then
# survive a passcode change); leave it unset and one is minted during setup.
JWT_SECRET: Final[str] = os.getenv("JWT_SECRET", "")
JWT_ALGORITHM: Final[str] = "HS256"
SESSION_COOKIE_NAME: Final[str] = "dayshift_session"
SESSION_TTL_HOURS: Final[int] = 24 * 14  # two weeks; single local user

# Mark the session cookie Secure (HTTPS only). Off for plain http://localhost;
# turn it on when the app is served over HTTPS (e.g. behind Netlify).
COOKIE_SECURE: Final[bool] = os.getenv("COOKIE_SECURE", "false").lower() in {
    "1",
    "true",
    "yes",
}

# When hosted publicly, the first-run setup screen is open to whoever reaches
# it first. Set this and setup additionally requires the token, so only you
# can claim the credential. Unused once setup has happened.
SETUP_TOKEN: Final[str] = os.getenv("SETUP_TOKEN", "")

# Legacy: the pre-setup password hash. Read only so an old .env does not look
# like a misconfiguration; it is no longer used to authenticate.
AUTH_PASSWORD_HASH: Final[str] = os.getenv("AUTH_PASSWORD_HASH", "")

# --- Scoring rules -----------------------------------------------------------

# Nothing before this date is tracked. Days in a par window that fall earlier
# are excluded from BOTH the numerator and the denominator, so the first week
# of tracking scores honestly over however many days actually exist.
TRACKING_START_DATE: Final[date] = date.fromisoformat(
    os.getenv("TRACKING_START_DATE", "2026-10-01")
)

# Par score = sum(minutes) / sum(effective_target) * 100 over this many
# CALENDAR days, ending YESTERDAY (today is excluded because it is still
# incomplete and would read artificially low all morning).
PAR_WINDOW_DAYS: Final[int] = 7
PAR_INCLUDES_TODAY: Final[bool] = False

# Warning thresholds, as percentages of par.
WARNING_PAR_THRESHOLD: Final[float] = 80.0
CRITICAL_PAR_THRESHOLD: Final[float] = 50.0
# Consecutive sub-80% days needed to enter warning / critical visual state.
WARNING_CONSECUTIVE_DAYS: Final[int] = 2
CRITICAL_CONSECUTIVE_DAYS: Final[int] = 3

# The weekly chart shows this many calendar days, ending today (unlike par,
# this view DOES include today — it is a log view, not a score).
WEEKLY_VIEW_DAYS: Final[int] = 7

# --- Category seed data ------------------------------------------------------
# Seeded once into the `categories` table. Editing these after first run has no
# effect; edit the database rows (or delete dayshift.db to re-seed).

DAY_CODES: Final[tuple[str, ...]] = ("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN")

ALL_DAYS: Final[str] = "MON,TUE,WED,THU,FRI,SAT,SUN"

# Seeded by name, so adding an entry here gives an existing database the new
# category on its next start without touching the ones already there.
# `group` is the domain the dashboard pages it under; `question_target` is an
# optional second finish line counted in questions (whichever comes first).
DEFAULT_CATEGORIES: Final[tuple[dict[str, object], ...]] = (
    # --- Projects: scheduled around the Thursday commitment ------------------
    {
        "name": "SDE Project",
        "group": "Projects",
        "daily_target_minutes": 180,
        "active_days": "MON,TUE,WED,FRI,SAT,SUN",  # Thursday excluded
    },
    {
        "name": "AI Automation",
        "group": "Projects",
        "daily_target_minutes": 60,
        "active_days": "MON,TUE,WED,FRI,SAT,SUN",  # Thursday excluded
    },
    {
        "name": "Project Maintenance",
        "group": "Projects",
        "daily_target_minutes": 20,
        "active_days": "SAT,SUN",
    },
    # --- Daily: fixed every day of the week, Thursday included ---------------
    {
        "name": "DSA",
        "group": "Daily",
        "daily_target_minutes": 120,
        "active_days": ALL_DAYS,
        # Done at 2 questions OR 120 minutes, whichever comes first. A partial
        # day scores the further of the two, never the sum.
        "question_target": 2,
    },
    {
        "name": "Exercise",
        "group": "Daily",
        "daily_target_minutes": 30,
        "active_days": ALL_DAYS,
    },
    {
        "name": "Coursework",
        "group": "Daily",
        "daily_target_minutes": 60,
        "active_days": ALL_DAYS,
    },
)

# --- Dev server --------------------------------------------------------------

FRONTEND_ORIGIN: Final[str] = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")

# --- Logging -----------------------------------------------------------------

LOG_LEVEL: Final[str] = os.getenv("LOG_LEVEL", "INFO").upper()

# --- Login throttling --------------------------------------------------------
# Single-user app on localhost, so this is not defending against a botnet — it
# just means a stray script cannot grind the password hash indefinitely.
LOGIN_MAX_ATTEMPTS: Final[int] = 10
LOGIN_ATTEMPT_WINDOW_SECONDS: Final[int] = 300


class ConfigError(RuntimeError):
    """Raised at startup when required configuration is missing or unusable."""


def validate() -> None:
    """Fail fast on bad configuration, rather than at the first request.

    Credentials are no longer configuration — they are set up in the app — so
    the only things checked here are the optional overrides. A completely
    empty environment is valid: first run needs no config at all.
    """
    problems: list[str] = []

    if JWT_SECRET and len(JWT_SECRET) < 32:
        problems.append(
            f"JWT_SECRET is set but only {len(JWT_SECRET)} characters; "
            "use at least 32, or leave it unset and one will be generated."
        )

    if TRACKING_START_DATE.year < 2000:
        problems.append(f"TRACKING_START_DATE looks wrong: {TRACKING_START_DATE}")

    if problems:
        raise ConfigError(
            "Configuration is invalid — see .env.example.\n\n"
            + "\n\n".join(f"  * {p}" for p in problems)
        )
