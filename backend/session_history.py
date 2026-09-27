"""Session change history: what a delete/edit/split/merge replaced, and undo.

Every change to recorded sessions stores full snapshots of the sessions
before and after. That gives three things from one table:

* **Undo at any time** — put the "before" sessions back, as long as the
  "after" ones are still exactly as the change left them (otherwise undoing
  would silently throw away a later edit) and putting them back would not
  overlap anything recorded since.
* **Deleted sessions are kept** (the user's choice) without a "deleted" flag
  every query would have to remember: the sessions table only holds what
  counts; the snapshot lives here.
* **The honesty ledger** lists deletions and minute edits made after the day
  they changed.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from typing import Any

from sqlalchemy.orm import Session as DbSession

import sessions_service as svc
from models import Deadline, SessionChange
from models import Session as WorkSession

# Every stored column of a session, in snapshot order. Tags are added by name.
FIELDS = (
    "id",
    "category_id",
    "log_date",
    "started_at",
    "ended_at",
    "minutes",
    "note",
    "source",
    "planned_end",
    "deadline_id",
    "measured_minutes",
    "git_ref",
    "created_at",
    "updated_at",
)


class UndoRefused(Exception):
    """An undo that would lose or double-count something; the message says why."""


def snapshot(session: WorkSession) -> dict[str, Any]:
    """Everything needed to put a session back exactly as it was."""
    data = {field: getattr(session, field) for field in FIELDS}
    data["tags"] = sorted(tag.name for tag in session.tags)
    return data


def record(
    db: DbSession,
    action: str,
    before: Sequence[dict[str, Any]],
    after: Sequence[WorkSession],
) -> SessionChange:
    """Store one change. `after` must already be flushed (so ids exist)."""
    after_snaps = [snapshot(s) for s in after]
    first = before[0]
    change = SessionChange(
        action=action,
        created_at=svc.now_iso(),
        log_date=first["log_date"],
        category_id=first["category_id"],
        before_json=json.dumps(list(before)),
        after_json=json.dumps(after_snaps),
        minutes_before=sum(int(s["minutes"]) for s in before),
        minutes_after=sum(int(s["minutes"]) for s in after_snaps),
    )
    db.add(change)
    return change


def before_of(change: SessionChange) -> list[dict[str, Any]]:
    """Snapshots of the sessions as they were before the change."""
    return list(json.loads(change.before_json))


def after_of(change: SessionChange) -> list[dict[str, Any]]:
    """Snapshots of the sessions the change produced."""
    return list(json.loads(change.after_json))


def _comparable(snap: dict[str, Any]) -> dict[str, Any]:
    # `updated_at` changes on any write, including ones that change nothing
    # visible; compare what the session actually says instead.
    return {k: v for k, v in snap.items() if k != "updated_at"}


def undo(db: DbSession, change: SessionChange) -> list[WorkSession]:
    """Put the sessions back as they were before `change`; return them.

    Refused when already undone, when a resulting session has changed or
    gone since (undo would discard that later change), or when a restored
    session would overlap one recorded since.
    """
    if change.undone_at is not None:
        raise UndoRefused("That change has already been undone.")

    current: list[WorkSession] = []
    for snap in after_of(change):
        session = db.get(WorkSession, snap["id"])
        if session is None or _comparable(snapshot(session)) != _comparable(snap):
            raise UndoRefused(
                "That session has changed since, so undoing this would lose the "
                "later change. Undo the later change first."
            )
        current.append(session)

    restoring = before_of(change)
    replaced = {s.id for s in current}
    for snap in restoring:
        if snap["ended_at"] is None:
            continue  # was running; it has no clock range to check yet
        start = svc.parse_iso(snap["started_at"])
        end = svc.parse_iso(snap["ended_at"])
        is_untimed = snap["source"] != "timer" and snap["started_at"][11:19] == "00:00:00"
        if is_untimed:
            continue
        clash = svc.overlapping(db, start, end, exclude_ids=replaced)
        if clash is not None:
            raise UndoRefused(
                f"Putting it back would overlap a session recorded since "
                f"({clash.started_at[11:16]}-{(clash.ended_at or 'now')[11:16]}, "
                f"{clash.category.name})."
            )

    for session in current:
        db.delete(session)
    db.flush()

    restored = [_recreate(db, snap) for snap in restoring]
    change.undone_at = svc.now_iso()
    db.flush()
    return restored


def _recreate(db: DbSession, snap: dict[str, Any]) -> WorkSession:
    """Rebuild a session from its snapshot, keeping its id when that is free."""
    deadline_id = snap["deadline_id"]
    if deadline_id is not None and db.get(Deadline, deadline_id) is None:
        deadline_id = None  # the exam was deleted meanwhile
    session = WorkSession(
        **{
            field: snap[field]
            for field in FIELDS
            if field not in ("id", "deadline_id", "updated_at")
        },
        deadline_id=deadline_id,
    )
    if db.get(WorkSession, snap["id"]) is None:
        session.id = snap["id"]
    session.tags = svc.resolve_tags(db, snap["tags"])
    db.add(session)
    db.flush()
    return session


def after_the_fact(change: SessionChange) -> bool:
    """Tell whether the change was made on a later day than the sessions' own."""
    return change.created_at[:10] > change.log_date


def in_ledger(change: SessionChange) -> bool:
    """Tell whether the honesty ledger lists this change.

    Deletions and minute edits made on a later day than the sessions' own.
    Splits and merges don't change how much time counts, so they are
    undoable but not listed.
    """
    if not after_the_fact(change):
        return False
    if change.action == "delete":
        return True
    return change.action == "edit" and change.minutes_before != change.minutes_after
