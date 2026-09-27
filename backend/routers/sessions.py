"""Sessions: the live timer, the session list, and adding a past session.

Editing, splitting, merging and deleting live in `session_edits`; search and
tag totals in `session_search`.

Sessions sit ALONGSIDE the hand-entered daily total rather than replacing it.
A day's scored minutes are `daily_logs.minutes_logged` plus that day's
finished sessions, so time you measured and time you recalled stay
distinguishable in the record while counting the same in the score.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

import sessions_service as svc
from auth import require_auth
from database import get_db
from models import Category, Deadline
from models import Session as WorkSession
from schemas import SessionCreate, SessionOut, SessionStart

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/sessions", tags=["sessions"], dependencies=[Depends(require_auth)]
)


def _require_category(db: Session, category_id: int) -> Category:
    category = db.get(Category, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail="No such category")
    return category


@router.get("/running", response_model=SessionOut | None)
def get_running(db: Session = Depends(get_db)) -> SessionOut | None:
    """Return the session currently being timed, if any."""
    session = svc.running_session(db)
    return svc.to_out(session) if session else None


@router.post("/start", response_model=SessionOut, status_code=status.HTTP_201_CREATED)
def start_session(payload: SessionStart, db: Session = Depends(get_db)) -> SessionOut:
    """Start the timer for a category.

    Any already-running session is stopped first: two timers running at once
    would count the same wall-clock minutes twice.
    """
    _require_category(db, payload.category_id)
    if payload.deadline_id is not None and db.get(Deadline, payload.deadline_id) is None:
        raise HTTPException(status_code=404, detail="No such exam or deadline")

    existing = svc.running_session(db)
    if existing is not None:
        if existing.category_id == payload.category_id:
            return svc.to_out(existing)
        svc.stop(db, existing)
        logger.info("Auto-stopped session %s to start another", existing.id)

    started = svc.now_iso()
    session = WorkSession(
        category_id=payload.category_id,
        log_date=started[:10],
        started_at=started,
        ended_at=None,
        minutes=0,
        note=payload.note,
        git_ref=svc.clean_ref(payload.git_ref),
        source="timer",
        planned_end=(
            (
                svc.parse_iso(started) + timedelta(minutes=payload.planned_minutes)
            ).isoformat()
            if payload.planned_minutes
            else None
        ),
        deadline_id=payload.deadline_id,
    )
    session.tags = svc.resolve_tags(db, payload.tags)
    db.add(session)
    db.commit()
    db.refresh(session)
    logger.info("Started timer for category %s", payload.category_id)
    return svc.to_out(session)


@router.post("/stop", response_model=SessionOut)
def stop_session(db: Session = Depends(get_db)) -> SessionOut:
    """Stop the running session and fix its minutes."""
    session = svc.running_session(db)
    if session is None:
        raise HTTPException(status_code=404, detail="No session is running")
    svc.stop(db, session)
    db.commit()
    db.refresh(session)
    logger.info("Stopped session %s at %s min", session.id, session.minutes)
    return svc.to_out(session)


@router.post("/discard", status_code=status.HTTP_204_NO_CONTENT)
def discard_running(db: Session = Depends(get_db)) -> None:
    """Throw away the running session without recording it.

    For the case where the timer was left running by mistake — better than
    recording hours you did not work.
    """
    session = svc.running_session(db)
    if session is None:
        raise HTTPException(status_code=404, detail="No session is running")
    db.delete(session)
    db.commit()


@router.get("", response_model=list[SessionOut])
def list_sessions(
    start: date | None = Query(default=None),
    end: date | None = Query(default=None),
    category_id: int | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
    db: Session = Depends(get_db),
) -> list[SessionOut]:
    """Sessions in a date range, newest first."""
    stmt = select(WorkSession)
    if start is not None:
        stmt = stmt.where(WorkSession.log_date >= start.isoformat())
    if end is not None:
        stmt = stmt.where(WorkSession.log_date <= end.isoformat())
    if category_id is not None:
        stmt = stmt.where(WorkSession.category_id == category_id)
    stmt = stmt.order_by(WorkSession.started_at.desc()).limit(limit)
    return [svc.to_out(s) for s in db.scalars(stmt).all()]


@router.post("", response_model=SessionOut, status_code=status.HTTP_201_CREATED)
def create_session(payload: SessionCreate, db: Session = Depends(get_db)) -> SessionOut:
    """Add a finished block of work by hand.

    Marked `source="manual"` so estimated time is never mistaken for measured
    time when reading the history back. With a start time, the block must be
    over already and must not overlap a recorded session — overlapping blocks
    would count the same minutes twice (the rule the timer follows too).
    """
    _require_category(db, payload.category_id)
    if payload.deadline_id is not None and db.get(Deadline, payload.deadline_id) is None:
        raise HTTPException(status_code=404, detail="No such exam or deadline")

    if payload.started_at is None:
        started = f"{payload.log_date.isoformat()}T00:00:00"
    else:
        started = _check_manual_start(db, payload)

    # End time is derived from the start plus the duration, not from "now".
    # Stamping the current clock would produce incoherent ranges such as
    # "21:15-17:14" for a session entered the morning after.
    ended = (svc.parse_iso(started) + timedelta(minutes=payload.minutes)).isoformat()

    session = WorkSession(
        category_id=payload.category_id,
        log_date=payload.log_date.isoformat(),
        started_at=started,
        ended_at=ended,
        minutes=payload.minutes,
        note=payload.note,
        git_ref=svc.clean_ref(payload.git_ref),
        source="manual",
        deadline_id=payload.deadline_id,
    )
    session.tags = svc.resolve_tags(db, payload.tags)
    db.add(session)
    db.commit()
    db.refresh(session)
    return svc.to_out(session)


def _check_manual_start(db: Session, payload: SessionCreate) -> str:
    """Validate a hand-added session's start time; return it normalised."""
    raw = payload.started_at or ""
    try:
        start = datetime.fromisoformat(raw).replace(microsecond=0, tzinfo=None)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Start time must look like 2026-09-24T09:30.",
        ) from None
    if start.date() != payload.log_date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="The start time has to be on the session's date.",
        )
    if start.time() == datetime.min.time():
        # Midnight exactly is how a session without a time is stored.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Start at 00:01 (12:01 AM) or later: midnight means 'no time'.",
        )
    end = start + timedelta(minutes=payload.minutes)
    if end > datetime.now():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="That block hasn't finished yet. Add it once it has, or time it.",
        )
    clash = svc.overlapping(db, start, end)
    if clash is not None:
        clash_end = clash.ended_at[11:16] if clash.ended_at else "now"
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Overlaps a session already recorded "
                f"({clash.started_at[11:16]}-{clash_end}, {clash.category.name}). "
                "The same minutes can't count twice."
            ),
        )
    return start.isoformat()
