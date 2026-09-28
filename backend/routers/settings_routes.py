"""Editable application settings, plus data export and backup listing."""

from __future__ import annotations

import csv
import io
import json
import logging
import re
import sqlite3
from contextlib import closing
from datetime import date
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

import config
import database
import exporter
import importer
import settings_store
from auth import require_auth
from database import get_db
from models import (
    Category,
    DailyLog,
)
from models import Session as WorkSession
from schemas import RestoreExportRequest, SettingOut, SettingsUpdate

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/settings", tags=["settings"], dependencies=[Depends(require_auth)]
)


@router.get("", response_model=list[SettingOut])
def list_settings(db: Session = Depends(get_db)) -> list[SettingOut]:
    """Every editable setting with its current value and bounds."""
    values = settings_store.load_all(db)
    out: list[SettingOut] = []
    for spec in settings_store.SPECS:
        value = values[spec.key]
        out.append(
            SettingOut(
                key=spec.key,
                label=spec.label,
                kind=spec.kind,
                value=_as_text(spec.kind, value),
                default=str(spec.default).lower()
                if spec.kind == "bool"
                else str(spec.default),
                minimum=spec.minimum,
                maximum=spec.maximum,
                help=spec.help,
                group=spec.group,
            )
        )
    return out


@router.put("", response_model=list[SettingOut])
def update_settings(
    payload: SettingsUpdate, db: Session = Depends(get_db)
) -> list[SettingOut]:
    """Apply a batch of setting changes.

    All-or-nothing: one invalid value rejects the whole batch, so the stored
    configuration is never left half-applied.
    """
    try:
        for key, value in payload.values.items():
            settings_store.write(db, key, value)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)
        ) from exc

    db.commit()
    logger.info("Settings updated: %s", ", ".join(sorted(payload.values)))
    return list_settings(db)


@router.post("/reset", response_model=list[SettingOut])
def reset_settings(
    group: str | None = Query(default=None), db: Session = Depends(get_db)
) -> list[SettingOut]:
    """Drop stored overrides, returning to the defaults.

    With `group`, only that section is reset — resetting scoring must not
    also forget the export folder.
    """
    from models import Setting

    keys = {spec.key for spec in settings_store.SPECS if group in (None, spec.group)}
    for row in db.scalars(select(Setting)).all():
        if row.key in keys:
            db.delete(row)
    db.commit()
    return list_settings(db)


# --- Export ------------------------------------------------------------------


@router.get("/export.json")
def export_json(db: Session = Depends(get_db)) -> StreamingResponse:
    """Full history as JSON — every table that holds user data."""
    payload = exporter.build_export(db)
    buffer = io.BytesIO(json.dumps(payload, indent=2).encode())
    return StreamingResponse(
        buffer,
        media_type="application/json",
        headers={
            "Content-Disposition": (
                f'attachment; filename="dayshift-{date.today().isoformat()}.json"'
            )
        },
    )


@router.get("/export.csv")
def export_csv(db: Session = Depends(get_db)) -> StreamingResponse:
    """Day-level history as CSV, one row per (date, category).

    Manual and timed minutes stay in separate columns so the distinction
    survives the export.
    """
    names = {c.id: c.name for c in db.scalars(select(Category)).all()}

    manual: dict[tuple[str, int], DailyLog] = {
        (row.log_date, row.category_id): row for row in db.scalars(select(DailyLog)).all()
    }
    timed: dict[tuple[str, int], int] = {}
    for session in db.scalars(
        select(WorkSession).where(WorkSession.ended_at.is_not(None))
    ).all():
        key = (session.log_date, session.category_id)
        timed[key] = timed.get(key, 0) + session.minutes

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        [
            "log_date",
            "category",
            "manual_minutes",
            "timed_minutes",
            "total_minutes",
            "override_target_minutes",
            "override_reason",
            # Appended last so existing column positions never shift.
            "questions_solved",
        ]
    )
    for key in sorted(set(manual) | set(timed)):
        log_date, category_id = key
        row = manual.get(key)
        manual_minutes = row.minutes_logged if row else 0
        timed_minutes = timed.get(key, 0)
        writer.writerow(
            [
                log_date,
                names.get(category_id, f"#{category_id}"),
                manual_minutes,
                timed_minutes,
                manual_minutes + timed_minutes,
                row.override_target_minutes if row else "",
                (row.override_reason or "") if row else "",
                row.questions_solved if row else 0,
            ]
        )

    return StreamingResponse(
        io.BytesIO(buffer.getvalue().encode()),
        media_type="text/csv",
        headers={
            "Content-Disposition": (
                f'attachment; filename="dayshift-{date.today().isoformat()}.csv"'
            )
        },
    )


@router.get("/backups")
def list_backups() -> list[dict[str, object]]:
    """Snapshots taken at startup, newest first."""
    backups = config.BACKUPS_DIR
    if not backups.exists():
        return []
    return [
        {
            "name": path.name,
            "bytes": path.stat().st_size,
            "modified": path.stat().st_mtime,
        }
        for path in sorted(backups.glob("dayshift-*.db"), reverse=True)
    ]


BACKUP_NAME = re.compile(r"dayshift-\d{8}-\d{6}\.db")


@router.post("/backups/{name}/restore")
def restore_backup(name: str) -> dict[str, str]:
    """Replace the live database with a startup snapshot.

    Safe to undo: the current database is snapshotted first, so the state
    being replaced is itself one of the backups afterwards. The snapshot is
    copied in with SQLite's backup API (consistent even with open
    connections), then migrated, since it may predate the current schema.
    Credentials live in auth.json and are not touched.
    """
    if not BACKUP_NAME.fullmatch(name):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="No such backup"
        )
    source = config.BACKUPS_DIR / name
    if not source.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="No such backup"
        )
    try:
        # `closing`: sqlite3's own `with` leaves the file open (see importer).
        with closing(sqlite3.connect(f"file:{source}?mode=ro", uri=True)) as check:
            check.execute("SELECT version_num FROM alembic_version").fetchone()
            check.execute("SELECT count(*) FROM daily_logs").fetchone()
    except sqlite3.Error as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="That file is not a readable Dayshift database",
        ) from exc

    # Keep the state being replaced. Skipped only when the newest snapshot is
    # identical, in which case that snapshot already holds it.
    database.snapshot_database()

    database.engine.dispose()
    with (
        closing(sqlite3.connect(f"file:{source}?mode=ro", uri=True)) as src,
        closing(sqlite3.connect(config.DATABASE_PATH)) as dest,
    ):
        src.backup(dest)
    database.engine.dispose()
    database.run_migrations()
    logger.warning("Database restored from %s", name)
    return {"restored": name}


@router.post("/restore-export/preview")
def restore_export_preview(data: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Check an export file and say what it holds. Changes nothing."""
    try:
        return importer.preview(data)
    except importer.RestoreRefused as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)
        ) from None


@router.post("/restore-export")
def restore_export(payload: RestoreExportRequest) -> dict[str, Any]:
    """Replace all tracking data with an export file's (type RESTORE to confirm).

    The current database is snapshotted first, so this can be undone from
    the backups list. Credentials and this machine's export folder and
    reminder settings are kept.
    """
    if payload.confirm != "RESTORE":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Type RESTORE to confirm.",
        )
    try:
        return importer.restore(payload.data)
    except importer.RestoreRefused as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)
        ) from None


@router.get("/export-folder")
def export_folder_status(db: Session = Depends(get_db)) -> dict[str, object]:
    """Where weekly exports go, and the newest one there."""
    return exporter.export_status(db)


@router.post("/export-folder/now")
def export_folder_now(db: Session = Depends(get_db)) -> dict[str, object]:
    """Write an export to the folder right now, due or not."""
    try:
        written = exporter.export_to_folder(db, force=True)
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Could not write there: {exc}",
        ) from exc
    if written is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Set a weekly export folder first",
        )
    return exporter.export_status(db)


def _as_text(kind: str, value: object) -> str:
    """Render a setting for the form: `110` not `110.0`, `true` not `True`."""
    if kind == "bool":
        return str(value).lower()
    if kind == "float":
        return format(value, "g")
    return str(value)
