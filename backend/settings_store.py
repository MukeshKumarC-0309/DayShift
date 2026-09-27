"""Runtime-editable settings, backed by the `settings` table.

config.py holds the defaults; anything the user changes on the Settings page is
stored here and wins. Keeping the two separate means a fresh database still
boots with sensible values, and "reset to default" is just deleting a row.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

import config
from models import Setting
from scoring import ScoringConfig


@dataclass(frozen=True)
class SettingSpec:
    """One editable setting: its type, default, and allowed range."""

    key: str
    label: str
    kind: str  # "int" | "float" | "date" | "bool" | "time" | "folder"
    default: Any
    minimum: float | None = None
    maximum: float | None = None
    help: str = ""
    # Which Settings section it belongs to. Only "scoring" settings change how
    # scores are calculated; the others never touch a number.
    group: str = "scoring"


# The order here is the order the Settings page renders them in.
SPECS: tuple[SettingSpec, ...] = (
    SettingSpec(
        "tracking_start_date",
        "Tracking start",
        "date",
        config.TRACKING_START_DATE.isoformat(),
        help="Days before this are excluded from par entirely.",
    ),
    SettingSpec(
        "par_window_days",
        "Par window (days)",
        "int",
        config.PAR_WINDOW_DAYS,
        minimum=2,
        maximum=90,
        help="How many calendar days the rolling par score covers.",
    ),
    SettingSpec(
        "par_includes_today",
        "Include today in par",
        "bool",
        config.PAR_INCLUDES_TODAY,
        help="Off by default: today is incomplete and would read low all morning.",
    ),
    SettingSpec(
        "warning_threshold",
        "Warning below (%)",
        "float",
        config.WARNING_PAR_THRESHOLD,
        minimum=1,
        maximum=100,
        help="A day under this percentage of its target counts as a miss.",
    ),
    SettingSpec(
        "critical_threshold",
        "Critical below (%)",
        "float",
        config.CRITICAL_PAR_THRESHOLD,
        minimum=1,
        maximum=100,
        help="Par under this goes straight to the critical state.",
    ),
    SettingSpec(
        "warning_days",
        "Warning after (days)",
        "int",
        config.WARNING_CONSECUTIVE_DAYS,
        minimum=1,
        maximum=30,
        help="Consecutive missed days before a category shows the warning border.",
    ),
    SettingSpec(
        "critical_days",
        "Critical after (days)",
        "int",
        config.CRITICAL_CONSECUTIVE_DAYS,
        minimum=1,
        maximum=60,
        help="Consecutive missed days before the border turns critical.",
    ),
    SettingSpec(
        "weekly_view_days",
        "Weekly chart (days)",
        "int",
        config.WEEKLY_VIEW_DAYS,
        minimum=3,
        maximum=31,
        help="How many days the weekly bar chart shows.",
    ),
    # --- Suggestions: never applied on their own ---------------------------
    SettingSpec(
        "target_review_high",
        "Suggest raising above (%)",
        "float",
        110.0,
        minimum=101,
        maximum=300,
        help="Weekly share of target that, held every week, prompts a raise.",
        group="suggestions",
    ),
    SettingSpec(
        "target_review_low",
        "Suggest lowering below (%)",
        "float",
        60.0,
        minimum=1,
        maximum=99,
        help="Weekly share of target that, held every week, prompts a cut.",
        group="suggestions",
    ),
    SettingSpec(
        "target_review_weeks",
        "Over how many weeks",
        "int",
        4,
        minimum=2,
        maximum=12,
        help="Complete weeks in a row before a suggestion appears.",
        group="suggestions",
    ),
    # --- Backups and reminders ---------------------------------------------
    SettingSpec(
        "export_dir",
        "Weekly export folder",
        "folder",
        "",
        help="A folder your cloud app syncs (iCloud Drive, Google Drive). "
        "Empty = off. Written by the backend, on this machine.",
        group="backup",
    ),
    SettingSpec(
        "export_keep",
        "Exports to keep",
        "int",
        12,
        minimum=1,
        maximum=200,
        help="Older weekly exports in that folder are deleted.",
        group="backup",
    ),
    SettingSpec(
        "reminder_enabled",
        "Evening reminder",
        "bool",
        False,
        help="A Mac notification listing what is still open today. Needs the "
        "reminder installed once (see README).",
        group="backup",
    ),
    SettingSpec(
        "reminder_time",
        "Reminder time",
        "time",
        "21:00",
        help="Local time on this machine; checked every 15 minutes.",
        group="backup",
    ),
)

SPEC_BY_KEY: dict[str, SettingSpec] = {spec.key: spec for spec in SPECS}


def _coerce(spec: SettingSpec, raw: str) -> Any:
    """Turn a stored string back into its declared type."""
    if spec.kind == "int":
        return int(raw)
    if spec.kind == "float":
        return float(raw)
    if spec.kind == "bool":
        return raw.lower() in {"1", "true", "yes", "on"}
    if spec.kind == "date":
        return date.fromisoformat(raw)
    if spec.kind == "time":
        return _clean_time(raw)
    return raw


def _clean_time(raw: str) -> str:
    """Normalise `H:MM` / `HH:MM` to `HH:MM`, or raise ValueError."""
    hours, minutes = (int(part) for part in str(raw).strip().split(":"))
    if not (0 <= hours < 24 and 0 <= minutes < 60):
        raise ValueError("Time must look like 21:00")
    return f"{hours:02d}:{minutes:02d}"


def _clean_folder(raw: str) -> str:
    """Expand and check a folder path; empty means off."""
    text = str(raw).strip()
    if not text:
        return ""
    path = Path(text).expanduser()
    if not path.is_dir():
        raise ValueError(f"{path} is not a folder on this machine")
    if not os.access(path, os.W_OK):
        raise ValueError(f"{path} is not writable")
    return str(path.resolve())


def _default(spec: SettingSpec) -> Any:
    if spec.kind == "date":
        return date.fromisoformat(str(spec.default))
    return spec.default


def load_all(db: Session) -> dict[str, Any]:
    """Every setting, with stored values overriding the defaults."""
    stored = {row.key: row.value for row in db.scalars(select(Setting)).all()}
    values: dict[str, Any] = {}
    for spec in SPECS:
        raw = stored.get(spec.key)
        if raw is None:
            values[spec.key] = _default(spec)
            continue
        try:
            values[spec.key] = _coerce(spec, raw)
        except (ValueError, TypeError):
            # A corrupt row should never take the app down; fall back quietly.
            values[spec.key] = _default(spec)
    return values


def scoring_config(db: Session) -> ScoringConfig:
    """Build the ScoringConfig the stats layer passes into scoring."""
    values = load_all(db)
    return ScoringConfig(
        tracking_start=values["tracking_start_date"],
        par_window_days=values["par_window_days"],
        par_includes_today=values["par_includes_today"],
        warning_threshold=values["warning_threshold"],
        critical_threshold=values["critical_threshold"],
        warning_days=values["warning_days"],
        critical_days=values["critical_days"],
    )


def write(db: Session, key: str, value: Any) -> None:
    """Store one setting, validating it against its spec.

    Raises ValueError for an unknown key or an out-of-range value, so a bad
    request fails loudly rather than silently persisting nonsense.
    """
    spec = SPEC_BY_KEY.get(key)
    if spec is None:
        raise ValueError(f"Unknown setting: {key}")

    if spec.kind == "bool":
        stored = "true" if bool(value) else "false"
    elif spec.kind == "time":
        stored = _clean_time(str(value))
    elif spec.kind == "folder":
        stored = _clean_folder(str(value))
    elif spec.kind == "date":
        stored = date.fromisoformat(str(value)).isoformat()
    else:
        number = float(value)
        if spec.minimum is not None and number < spec.minimum:
            raise ValueError(f"{spec.label} must be at least {spec.minimum:g}")
        if spec.maximum is not None and number > spec.maximum:
            raise ValueError(f"{spec.label} must be at most {spec.maximum:g}")
        stored = str(int(number)) if spec.kind == "int" else str(number)

    row = db.get(Setting, key)
    if row is None:
        db.add(Setting(key=key, value=stored))
    else:
        row.value = stored
