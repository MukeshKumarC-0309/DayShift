"""Restore from a JSON export: replace every table with the file's copy.

The export's `tables` section (format 2) holds every row of every table. A
restore builds a brand-new database from it in a temporary file, migrated
to the current schema, checks it, and only then swaps it in — the same way
a snapshot is restored, with the current database snapshotted first so the
restore itself can be undone (the user's choice: replace, not merge).

Left as they are on this machine: credentials (auth.json, never in an
export) and the machine-specific settings — the export folder and the
evening reminder — which describe this Mac, not your history.
"""

from __future__ import annotations

import logging
import os
import sqlite3
import tempfile
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, insert

import config
import database
from models import Base

logger = logging.getLogger(__name__)

# Settings that describe this machine rather than the history being restored.
MACHINE_SETTINGS = ("export_dir", "export_keep", "reminder_enabled", "reminder_time")

# What the preview counts, as (table, label).
PREVIEW = (
    ("categories", "categories"),
    ("daily_logs", "daily entries"),
    ("sessions", "sessions"),
    ("problems", "problems"),
    ("checkins", "check-ins"),
    ("deadlines", "exams and deadlines"),
    ("habits", "habits"),
    ("milestones", "milestones"),
)


class RestoreRefused(Exception):
    """The file can't be restored; the message says why."""


def _tables(data: Any) -> dict[str, list[dict[str, Any]]]:
    """Validate the file's shape and return its tables."""
    if not isinstance(data, dict):
        raise RestoreRefused("That isn't a Dayshift export.")
    if data.get("format") != 2 or not isinstance(data.get("tables"), dict):
        raise RestoreRefused(
            "This export is from an older Dayshift and has no exact copy of the "
            "data to restore from. Export again (Settings → Export now) and use "
            "the new file."
        )
    schema = data.get("schema")
    if schema not in database.known_revisions():
        raise RestoreRefused(
            "This export is from a newer Dayshift than this one. Update the app first."
        )
    tables = data["tables"]
    known = {table.name: table for table in Base.metadata.sorted_tables}
    for name, rows in tables.items():
        if name not in known:
            raise RestoreRefused(f"Unknown table in the export: {name}.")
        if not isinstance(rows, list) or not all(isinstance(r, dict) for r in rows):
            raise RestoreRefused(f"The export's {name} table is damaged.")
        columns = {c.name for c in known[name].columns}
        for row in rows:
            extra = set(row) - columns
            if extra:
                raise RestoreRefused(
                    f"The export's {name} table has columns this version "
                    f"doesn't know ({', '.join(sorted(extra))})."
                )
    return tables


def preview(data: Any) -> dict[str, Any]:
    """Summarise the file, so it can be checked before anything is replaced."""
    tables = _tables(data)
    sessions = tables.get("sessions", [])
    logs = tables.get("daily_logs", [])
    days = sorted({r["log_date"] for r in logs} | {r["log_date"] for r in sessions})
    return {
        "exported_at": data.get("exported_at"),
        "first_day": days[0] if days else None,
        "last_day": days[-1] if days else None,
        "counts": [
            {"label": label, "count": len(tables.get(table, []))}
            for table, label in PREVIEW
        ],
    }


def _build(tables: dict[str, list[dict[str, Any]]], path: Path) -> None:
    """Create a migrated database at `path` holding exactly `tables`."""
    url = f"sqlite:///{path}"
    database.run_migrations(url)
    engine = create_engine(url)
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
            for table in Base.metadata.sorted_tables:
                rows = tables.get(table.name, [])
                if rows:
                    connection.execute(insert(table), rows)
            _keep_machine_settings(connection)
            problems = connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall()
            if problems:
                raise RestoreRefused(
                    "The export refers to rows that aren't in it "
                    f"(first: table {problems[0][0]}). Nothing was changed."
                )
            ok = connection.exec_driver_sql("PRAGMA integrity_check").scalar()
            if ok != "ok":
                raise RestoreRefused("The rebuilt database failed its integrity check.")
    finally:
        engine.dispose()


def _keep_machine_settings(connection: Any) -> None:
    """Carry this machine's export folder and reminder over into the new copy."""
    placeholders = ",".join("?" for _ in MACHINE_SETTINGS)
    with sqlite3.connect(config.DATABASE_PATH) as live:
        current = live.execute(
            f"SELECT key, value, updated_at FROM settings WHERE key IN ({placeholders})",
            MACHINE_SETTINGS,
        ).fetchall()
    connection.exec_driver_sql(
        f"DELETE FROM settings WHERE key IN ({placeholders})", MACHINE_SETTINGS
    )
    for row in current:
        connection.exec_driver_sql(
            "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)", row
        )


def restore(data: Any) -> dict[str, Any]:
    """Replace the live database with the export's contents; return the preview."""
    tables = _tables(data)
    summary = preview(data)
    # Next to the live database: same disk, so the copy-in is fast and safe.
    handle, name = tempfile.mkstemp(
        prefix="restore-", suffix=".db", dir=Path(config.DATABASE_PATH).parent
    )
    os.close(handle)
    path = Path(name)
    try:
        try:
            _build(tables, path)
        except RestoreRefused:
            raise
        except Exception as exc:
            logger.exception("Restore from export failed while rebuilding")
            raise RestoreRefused(
                f"The export couldn't be rebuilt ({type(exc).__name__}). "
                "Nothing was changed."
            ) from exc

        database.snapshot_database()
        database.engine.dispose()
        with (
            sqlite3.connect(f"file:{path}?mode=ro", uri=True) as source,
            sqlite3.connect(config.DATABASE_PATH) as dest,
        ):
            source.backup(dest)
        database.engine.dispose()
        database.run_migrations()
    finally:
        path.unlink(missing_ok=True)
    logger.warning("Database replaced from an export dated %s", summary["exported_at"])
    return summary
