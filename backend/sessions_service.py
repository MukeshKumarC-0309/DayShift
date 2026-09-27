"""Session and tag operations shared by the routers.

Kept out of the route modules because the timer rules (one running session at
a time, minutes fixed only on stop) are logic, not transport.
"""

from __future__ import annotations

from collections.abc import Collection
from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from models import Session as WorkSession
from models import Tag
from schemas import SessionOut

ISO_SECONDS = "%Y-%m-%dT%H:%M:%S"


def now_iso() -> str:
    """Local-time ISO 8601 timestamp, second precision."""
    return datetime.now().replace(microsecond=0).isoformat()


def parse_iso(value: str) -> datetime:
    """Parse one of our stored timestamps."""
    return datetime.strptime(value[:19], ISO_SECONDS)


def clean_ref(raw: str | None) -> str | None:
    """Trim a branch/issue reference; blank means none."""
    text = (raw or "").strip()
    return text or None


def has_clock_time(session: WorkSession) -> bool:
    """Tell whether a session has a real time of day.

    A hand-added session without one is stored at exactly midnight as a
    sentinel: it belongs to a date but to no particular hours, so time-of-day
    charts and the overlap check leave it out.
    """
    return not (session.source != "timer" and session.started_at[11:19] == "00:00:00")


def overlapping(
    db: DbSession, start: datetime, end: datetime, exclude_ids: Collection[int] = ()
) -> WorkSession | None:
    """Return the first recorded session whose clock time overlaps [start, end).

    A running session counts up to now. Touching ends (10:00-11:00 and
    11:00-12:00) do not overlap.
    """
    window = (start - timedelta(days=1)).date().isoformat()
    candidates = db.scalars(
        select(WorkSession)
        .where(WorkSession.log_date >= window)
        .where(WorkSession.log_date <= (end + timedelta(days=1)).date().isoformat())
        .order_by(WorkSession.started_at)
    ).all()
    for other in candidates:
        if other.id in exclude_ids or not has_clock_time(other):
            continue
        other_start = parse_iso(other.started_at)
        other_end = parse_iso(other.ended_at) if other.ended_at else datetime.now()
        if other_start < end and start < other_end:
            return other
    return None


def elapsed_minutes(session: WorkSession) -> int:
    """Minutes a session represents right now.

    For a finished session that is the stored value; for a running one it is
    live wall-clock time, computed on read so nothing has to tick in the
    background.
    """
    if session.ended_at is not None:
        return session.minutes
    delta = datetime.now() - parse_iso(session.started_at)
    return max(0, int(delta.total_seconds() // 60))


def running_session(db: DbSession) -> WorkSession | None:
    """Return the open session, if one exists.

    Only one may run at a time — a timer that could run twice for the same
    minutes would double-count them. A focus block past its planned end is
    closed first (see `settle_expired`), so it is never reported as running.
    """
    settle_expired(db)
    return db.scalar(select(WorkSession).where(WorkSession.ended_at.is_(None)))


def settle_expired(db: DbSession) -> None:
    """Close a focus block whose planned end has passed, AT that end.

    DECISION (focus mode, chosen with the user): a focus block stops itself at
    the length planned. If the page was closed or the laptop slept, the block
    still records exactly the planned minutes — never the hours after it.
    Commits only when it changed something.
    """
    session = db.scalar(
        select(WorkSession).where(
            WorkSession.ended_at.is_(None), WorkSession.planned_end.is_not(None)
        )
    )
    if session is None or session.planned_end is None:
        return
    if datetime.now() < parse_iso(session.planned_end):
        return
    session.ended_at = session.planned_end
    planned = parse_iso(session.planned_end) - parse_iso(session.started_at)
    session.minutes = max(0, int(planned.total_seconds() // 60))
    db.commit()


def resolve_tags(db: DbSession, names: list[str]) -> list[Tag]:
    """Fetch or create tags by name, normalised to lowercase."""
    resolved: list[Tag] = []
    for raw in names:
        name = raw.strip().lower()
        if not name:
            continue
        tag = db.scalar(select(Tag).where(Tag.name == name))
        if tag is None:
            tag = Tag(name=name)
            db.add(tag)
            db.flush()
        if tag not in resolved:
            resolved.append(tag)
    return resolved


def to_out(session: WorkSession) -> SessionOut:
    """Serialise a session for the API."""
    return SessionOut(
        id=session.id,
        category_id=session.category_id,
        log_date=session.log_date,
        started_at=session.started_at,
        ended_at=session.ended_at,
        minutes=session.minutes,
        note=session.note,
        source=session.source,
        tags=sorted(tag.name for tag in session.tags),
        is_running=session.is_running,
        elapsed_minutes=elapsed_minutes(session),
        planned_end=session.planned_end,
        deadline_id=session.deadline_id,
        measured_minutes=session.measured_minutes,
        git_ref=session.git_ref,
    )


def stop(db: DbSession, session: WorkSession) -> WorkSession:
    """Close a running session and fix its minutes."""
    if session.ended_at is not None:
        return session
    # Measure BEFORE closing: once `ended_at` is set, elapsed_minutes returns
    # the stored minutes (0 for a running session), which recorded every
    # stopped timer as 0 minutes.
    session.minutes = elapsed_minutes(session)
    session.ended_at = now_iso()
    return session


def timed_minutes_for(db: DbSession, category_id: int, day: date) -> int:
    """Finished timed minutes for one category on one date."""
    total = db.scalar(
        select(func.sum(WorkSession.minutes)).where(
            WorkSession.category_id == category_id,
            WorkSession.log_date == day.isoformat(),
            WorkSession.ended_at.is_not(None),
        )
    )
    return int(total or 0)


def sessions_for_day(db: DbSession, day: date) -> list[WorkSession]:
    """Every session recorded on a date, oldest first."""
    return list(
        db.scalars(
            select(WorkSession)
            .where(WorkSession.log_date == day.isoformat())
            .order_by(WorkSession.started_at)
        ).all()
    )
