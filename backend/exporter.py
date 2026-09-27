"""The full JSON export — one function, used by every way of exporting.

The Settings download, the weekly export to a folder, and "Export now" all
call `build_export`, so the three files are always identical in shape.
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

import database
import settings_store
from models import (
    Base,
    Category,
    CategoryTarget,
    CheckIn,
    Commitment,
    DailyLog,
    Deadline,
    GitRepo,
    Habit,
    Milestone,
    PlanMinutes,
    PlanTask,
    Problem,
    WeeklyReview,
)
from models import Session as WorkSession

logger = logging.getLogger(__name__)

EXPORT_PREFIX = "dayshift-export-"
# One export per ISO week is enough; the backend checks this often.
EXPORT_EVERY = timedelta(days=7)


EXPORT_FORMAT = 2


def dump_tables(db: Session) -> dict[str, list[dict[str, Any]]]:
    """Every row of every table, every column — what a restore reads.

    Generated from the schema itself, so a column added later is exported
    without anyone remembering to add it here.
    """
    return {
        table.name: [dict(row) for row in db.execute(select(table)).mappings()]
        for table in Base.metadata.sorted_tables
    }


def build_export(db: Session) -> dict[str, Any]:
    """Full history as a JSON-ready dict — every table that holds user data.

    The named sections are for reading; `tables` is the exact copy that
    Settings → Data → Restore from an export uses.
    """
    return {
        "format": EXPORT_FORMAT,
        "schema": database.head_revision(),
        "exported_at": date.today().isoformat(),
        "tables": dump_tables(db),
        "categories": [
            {
                "id": c.id,
                "name": c.name,
                "display_order": c.display_order,
                "group_name": c.group_name,
                "archived_at": c.archived_at,
            }
            for c in db.scalars(select(Category).order_by(Category.id)).all()
        ],
        "category_targets": [
            {
                "category_id": t.category_id,
                "effective_from": t.effective_from,
                "daily_target_minutes": t.daily_target_minutes,
                "active_days": t.active_days,
                "question_target": t.question_target,
            }
            for t in db.scalars(
                select(CategoryTarget).order_by(CategoryTarget.category_id)
            ).all()
        ],
        "daily_logs": [
            {
                "log_date": row.log_date,
                "category_id": row.category_id,
                "minutes_logged": row.minutes_logged,
                "questions_solved": row.questions_solved,
                "override_target_minutes": row.override_target_minutes,
                "override_reason": row.override_reason,
            }
            for row in db.scalars(select(DailyLog).order_by(DailyLog.log_date)).all()
        ],
        "sessions": [
            {
                "category_id": s.category_id,
                "log_date": s.log_date,
                "started_at": s.started_at,
                "ended_at": s.ended_at,
                "minutes": s.minutes,
                "note": s.note,
                "source": s.source,
                "measured_minutes": s.measured_minutes,
                "git_ref": s.git_ref,
                "tags": sorted(tag.name for tag in s.tags),
                "planned_end": s.planned_end,
                "deadline_id": s.deadline_id,
            }
            for s in db.scalars(
                select(WorkSession).order_by(WorkSession.started_at)
            ).all()
        ],
        "weekly_reviews": [
            {"week_start": r.week_start, "reflection": r.reflection}
            for r in db.scalars(select(WeeklyReview).order_by(WeeklyReview.week_start))
        ],
        "commitments": [
            {
                "week_start": c.week_start,
                "category_id": c.category_id,
                "minutes": c.minutes,
            }
            for c in db.scalars(select(Commitment).order_by(Commitment.week_start))
        ],
        "problems": [
            {
                "category_id": pr.category_id,
                "title": pr.title,
                "url": pr.url,
                "topic": pr.topic,
                "difficulty": pr.difficulty,
                "needed_hint": pr.needed_hint,
                "solved_on": pr.solved_on,
                "notes": pr.notes,
                "reviews": [
                    {"reviewed_on": r.reviewed_on, "outcome": r.outcome}
                    for r in pr.reviews
                ],
            }
            for pr in db.scalars(select(Problem).order_by(Problem.solved_on))
        ],
        "checkins": [
            {
                "check_date": c.check_date,
                "sleep_minutes": c.sleep_minutes,
                "energy": c.energy,
                "mood": c.mood,
                "note": c.note,
            }
            for c in db.scalars(select(CheckIn).order_by(CheckIn.check_date))
        ],
        "deadlines": [
            {
                "id": d.id,
                "title": d.title,
                "kind": d.kind,
                "due_date": d.due_date,
                "notes": d.notes,
                "done_at": d.done_at,
                "overrides": [
                    {"category_id": o.category_id, "target_minutes": o.target_minutes}
                    for o in d.overrides
                ],
            }
            for d in db.scalars(select(Deadline).order_by(Deadline.due_date))
        ],
        "milestones": [
            {
                "category_id": m.category_id,
                "title": m.title,
                "notes": m.notes,
                "done_on": m.done_on,
            }
            for m in db.scalars(select(Milestone).order_by(Milestone.id))
        ],
        "plan_minutes": [
            {
                "plan_date": pm.plan_date,
                "category_id": pm.category_id,
                "minutes": pm.minutes,
            }
            for pm in db.scalars(select(PlanMinutes).order_by(PlanMinutes.plan_date))
        ],
        "plan_tasks": [
            {"plan_date": t.plan_date, "text": t.text, "done": t.done}
            for t in db.scalars(select(PlanTask).order_by(PlanTask.plan_date))
        ],
        "habits": [
            {
                "name": h.name,
                "active_days": h.active_days,
                "start_date": h.start_date,
                "archived_at": h.archived_at,
                "checks": sorted(c.check_date for c in h.checks),
            }
            for h in db.scalars(select(Habit).order_by(Habit.id))
        ],
        "git_repos": [
            {"path": r.path, "category_id": r.category_id}
            for r in db.scalars(select(GitRepo).order_by(GitRepo.id))
        ],
    }


def _exports(folder: Path) -> list[Path]:
    return sorted(folder.glob(f"{EXPORT_PREFIX}*.json"))


def export_to_folder(db: Session, force: bool = False) -> Path | None:
    """Write an export into the configured folder if one is due.

    Due means: a folder is set, and the newest export there is a week old or
    missing (or `force`). Keeps the newest `export_keep` files. Returns the
    path written, or None when nothing was due. Raises OSError if the folder
    cannot be written.
    """
    values = settings_store.load_all(db)
    folder_text = values["export_dir"]
    if not folder_text:
        return None
    folder = Path(folder_text)
    existing = _exports(folder)
    if existing and not force:
        age = datetime.now() - datetime.fromtimestamp(existing[-1].stat().st_mtime)
        if age < EXPORT_EVERY:
            return None
    target = folder / f"{EXPORT_PREFIX}{date.today().isoformat()}.json"
    tmp = target.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(build_export(db), indent=2))
    tmp.replace(target)  # atomic: a sync client never sees half a file
    for stale in _exports(folder)[: -values["export_keep"]]:
        stale.unlink(missing_ok=True)
    logger.info("Exported to %s", target)
    return target


def export_status(db: Session) -> dict[str, Any]:
    """Report the folder, the newest export in it, and whether it is usable."""
    folder_text = settings_store.load_all(db)["export_dir"]
    if not folder_text:
        return {"folder": None, "latest": None, "latest_at": None, "ok": True}
    folder = Path(folder_text)
    if not folder.is_dir():
        return {"folder": folder_text, "latest": None, "latest_at": None, "ok": False}
    existing = _exports(folder)
    latest = existing[-1] if existing else None
    return {
        "folder": folder_text,
        "latest": latest.name if latest else None,
        "latest_at": (
            datetime.fromtimestamp(latest.stat().st_mtime)
            .replace(microsecond=0)
            .isoformat()
            if latest
            else None
        ),
        "ok": True,
    }
