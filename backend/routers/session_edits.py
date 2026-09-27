"""Changing recorded sessions: edit, split, merge, delete — and undo.

Every change is written to `session_changes` with full before/after
snapshots (see `session_history`), so any of them can be undone later and a
deletion or minute edit made after the day shows in the honesty ledger.
"""

from __future__ import annotations

import logging
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

import session_history as history
import sessions_service as svc
from auth import require_auth
from database import get_db
from models import Category, Deadline, SessionChange
from models import Session as WorkSession
from schemas import (
    SessionChangeOut,
    SessionMerge,
    SessionOut,
    SessionSplit,
    SessionUpdate,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/sessions", tags=["sessions"], dependencies=[Depends(require_auth)]
)


def _require_category(db: Session, category_id: int) -> Category:
    category = db.get(Category, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail="No such category")
    return category


@router.patch("/{session_id}", response_model=SessionOut)
def update_session(
    session_id: int, payload: SessionUpdate, db: Session = Depends(get_db)
) -> SessionOut:
    """Edit a stored session's minutes, note, date, category, tags or exam.

    Changing a timer session's minutes makes it `manual`: the number is no
    longer what was measured. The measured figure is kept in
    `measured_minutes` (the first time only, so it always holds the timer's
    own reading).
    """
    session = db.get(WorkSession, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="No such session")
    before = history.snapshot(session)

    if payload.minutes is not None:
        if session.is_running:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Stop the session before editing its minutes.",
            )
        if payload.minutes != session.minutes and session.source == "timer":
            session.measured_minutes = session.minutes
            session.source = "manual"
        session.minutes = payload.minutes
    if payload.note is not None:
        session.note = payload.note or None
    if payload.log_date is not None:
        session.log_date = payload.log_date.isoformat()
    if payload.category_id is not None:
        _require_category(db, payload.category_id)
        session.category_id = payload.category_id
    if payload.tags is not None:
        session.tags = svc.resolve_tags(db, payload.tags)
    if payload.git_ref is not None:
        session.git_ref = svc.clean_ref(payload.git_ref)
    if payload.deadline_id is not None:
        if payload.deadline_id == 0:
            session.deadline_id = None
        elif db.get(Deadline, payload.deadline_id) is None:
            raise HTTPException(status_code=404, detail="No such exam or deadline")
        else:
            session.deadline_id = payload.deadline_id

    db.flush()
    db.refresh(session)
    if not session.is_running and history.snapshot(session) != before:
        history.record(db, "edit", [before], [session])
    db.commit()
    db.refresh(session)
    return svc.to_out(session)


@router.post("/{session_id}/split", response_model=list[SessionOut])
def split_session(
    session_id: int, payload: SessionSplit, db: Session = Depends(get_db)
) -> list[SessionOut]:
    """Split one session in two — for a block that covered two things."""
    session = db.get(WorkSession, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="No such session")
    if session.is_running:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Stop the session first."
        )
    if payload.at_minute >= session.minutes:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Split point must be below {session.minutes}.",
        )

    before = history.snapshot(session)
    remainder = session.minutes - payload.at_minute
    split_at = svc.parse_iso(session.started_at) + timedelta(minutes=payload.at_minute)
    original_end = session.ended_at
    session.minutes = payload.at_minute
    # The first half ends where the second begins. (It used to keep the
    # original end, so the two halves' clock ranges overlapped.)
    session.ended_at = split_at.isoformat()

    second = WorkSession(
        category_id=session.category_id,
        log_date=session.log_date,
        started_at=split_at.isoformat(),
        ended_at=original_end,
        minutes=remainder,
        note=session.note,
        git_ref=session.git_ref,
        source=session.source,
        # Exam prep follows both halves; otherwise splitting would quietly
        # take the second half's minutes off the exam's total.
        deadline_id=session.deadline_id,
    )
    second.tags = list(session.tags)
    db.add(second)
    db.flush()
    history.record(db, "split", [before], [session, second])
    db.commit()
    db.refresh(session)
    db.refresh(second)
    return [svc.to_out(session), svc.to_out(second)]


@router.post("/merge", response_model=SessionOut)
def merge_sessions(payload: SessionMerge, db: Session = Depends(get_db)) -> SessionOut:
    """Merge sessions of one category on one day into one — the undo of split.

    The merged session keeps the earliest start and the latest end, and its
    minutes are the SUM of the parts (the clock span may include a gap).
    Refused, with the reason, when the parts are in different categories or
    on different days, when one is still running or has no time of day, when
    another session was recorded between them (the merged block would
    overlap it), or when they count toward different exams (the user's
    choices: a merge never moves minutes between exams or double-counts).

    Notes and branch references are joined, tags combined. It stays `timer`
    only if every part was measured; otherwise it is `manual`, and keeps a
    `measured_minutes` total only when every part was timed originally.
    """
    ids = list(dict.fromkeys(payload.session_ids))
    if len(ids) < 2:
        raise _unprocessable("Pick at least two different sessions to merge.")
    parts = [db.get(WorkSession, session_id) for session_id in ids]
    if any(part is None for part in parts):
        raise HTTPException(status_code=404, detail="No such session")
    sessions = sorted((p for p in parts if p is not None), key=lambda s: s.started_at)

    if any(s.is_running for s in sessions):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Stop the timer first."
        )
    if len({s.category_id for s in sessions}) > 1:
        raise _unprocessable("Only sessions in the same category can be merged.")
    if len({s.log_date for s in sessions}) > 1:
        raise _unprocessable("Only sessions on the same day can be merged.")
    if not all(svc.has_clock_time(s) for s in sessions):
        raise _unprocessable("A session without a time of day can't be merged.")
    if len({s.deadline_id for s in sessions}) > 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "These count toward different exams (or only some of them do). "
                "Set the same exam on each first, so no exam's hours change silently."
            ),
        )

    start = svc.parse_iso(sessions[0].started_at)
    end = max(svc.parse_iso(s.ended_at or s.started_at) for s in sessions)
    between = svc.overlapping(db, start, end, exclude_ids={s.id for s in sessions})
    if between is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Another session was recorded in between "
                f"({between.started_at[11:16]}-{(between.ended_at or 'now')[11:16]}, "
                f"{between.category.name}); the merged block would overlap it."
            ),
        )

    refs = list(dict.fromkeys(s.git_ref for s in sessions if s.git_ref))
    joined_ref = ", ".join(refs) or None
    if joined_ref is not None and len(joined_ref) > 120:
        raise _unprocessable(
            "The branch references are too long to join; edit them first."
        )

    before = [history.snapshot(s) for s in sessions]

    # Totals first, from the untouched parts: `keep` is one of them.
    all_timer = all(s.source == "timer" for s in sessions)
    originally_timed = all(
        s.source == "timer" or s.measured_minutes is not None for s in sessions
    )
    total = sum(s.minutes for s in sessions)
    measured_total = sum(
        s.measured_minutes if s.measured_minutes is not None else s.minutes
        for s in sessions
    )
    note = " · ".join(dict.fromkeys(s.note for s in sessions if s.note)) or None
    tags = list(dict.fromkeys(tag for s in sessions for tag in s.tags))

    keep, others = sessions[0], sessions[1:]
    keep.minutes = total
    keep.ended_at = end.isoformat()
    keep.planned_end = None
    keep.note = note
    keep.git_ref = joined_ref
    keep.tags = tags
    keep.source = "timer" if all_timer else "manual"
    keep.measured_minutes = measured_total if not all_timer and originally_timed else None
    for other in others:
        db.delete(other)
    db.flush()
    history.record(db, "merge", before, [keep])
    db.commit()
    db.refresh(keep)
    logger.info("Merged sessions %s into %s", [s.id for s in others], keep.id)
    return svc.to_out(keep)


def _unprocessable(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=detail)


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(session_id: int, db: Session = Depends(get_db)) -> None:
    """Delete a session. It stops counting at once but is kept in the history.

    So it can be restored later (undo), and a deletion made after the day it
    belonged to shows in the honesty ledger. A running session is discarded
    with /discard instead — it never counted.
    """
    session = db.get(WorkSession, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="No such session")
    if session.is_running:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That session is still running; stop or discard the timer instead.",
        )
    before = history.snapshot(session)
    db.delete(session)
    db.flush()
    history.record(db, "delete", [before], [])
    db.commit()


# --- History and undo --------------------------------------------------------


@router.get("/changes", response_model=list[SessionChangeOut])
def list_changes(
    after_the_fact: bool = Query(default=False),
    limit: int = Query(default=50, ge=1, le=500),
    db: Session = Depends(get_db),
) -> list[SessionChangeOut]:
    """Recent changes to sessions, newest first.

    `after_the_fact=true` keeps only deletions and minute edits made on a
    later day than the sessions' own — the ones the honesty ledger lists.
    """
    rows = db.scalars(
        select(SessionChange).order_by(SessionChange.id.desc()).limit(limit * 5)
    ).all()
    out: list[SessionChangeOut] = []
    for change in rows:
        if after_the_fact and not history.in_ledger(change):
            continue
        out.append(_change_out(db, change))
        if len(out) == limit:
            break
    return out


@router.post("/changes/{change_id}/undo", response_model=list[SessionOut])
def undo_change(change_id: int, db: Session = Depends(get_db)) -> list[SessionOut]:
    """Put sessions back as they were before a change; return them.

    Works at any time, but refuses (409, saying why) if the change was already
    undone, a session it produced has changed since, or putting the old ones
    back would overlap a session recorded since.
    """
    change = db.get(SessionChange, change_id)
    if change is None:
        raise HTTPException(status_code=404, detail="No such change")
    try:
        restored = history.undo(db, change)
    except history.UndoRefused as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from None
    db.commit()
    for session in restored:
        db.refresh(session)
    logger.info("Undid session change %s (%s)", change.id, change.action)
    return [svc.to_out(s) for s in restored]


def _change_out(db: Session, change: SessionChange) -> SessionChangeOut:
    category = db.get(Category, change.category_id)
    before = history.before_of(change)
    return SessionChangeOut(
        id=change.id,
        action=change.action,
        created_at=change.created_at,
        log_date=change.log_date,
        category_id=change.category_id,
        category_name=category.name if category else "Category",
        minutes_before=change.minutes_before,
        minutes_after=change.minutes_after,
        sessions_before=len(before),
        notes=[s["note"] for s in before if s.get("note")],
        after_the_fact=history.after_the_fact(change),
        undone_at=change.undone_at,
    )
