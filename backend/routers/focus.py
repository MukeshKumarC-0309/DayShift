"""Focus-block stats: how many 25/50 blocks were finished vs ended early.

A block counts as finished when it ran to its planned end (the timer closes
it there by itself), and as ended early when it was stopped before. Blocks
later merged into another session lose their planned end and drop out.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

import sessions_service as svc
from auth import require_auth
from database import get_db
from models import Session as WorkSession
from schemas import FocusLength, FocusStats

router = APIRouter(
    prefix="/api/stats", tags=["stats"], dependencies=[Depends(require_auth)]
)


@dataclass(frozen=True)
class Block:
    """One finished focus block."""

    planned: int  # minutes it was set for
    minutes: int  # minutes it recorded
    finished: bool  # ran to its planned end


def to_block(session: WorkSession) -> Block | None:
    """Return a finished session's focus block, or None if it wasn't one."""
    if session.planned_end is None or session.ended_at is None:
        return None
    start = svc.parse_iso(session.started_at)
    planned = round((svc.parse_iso(session.planned_end) - start).total_seconds() / 60)
    finished = session.ended_at >= session.planned_end
    return Block(planned=planned, minutes=session.minutes, finished=finished)


def summarise(blocks: list[Block], start: date, end: date) -> FocusStats:
    """Count blocks overall and per planned length (25, 50, …)."""
    lengths: dict[int, list[Block]] = {}
    for block in blocks:
        lengths.setdefault(block.planned, []).append(block)
    early = [b for b in blocks if not b.finished]
    return FocusStats(
        start=start.isoformat(),
        end=end.isoformat(),
        blocks=len(blocks),
        finished=len(blocks) - len(early),
        ended_early=len(early),
        focus_minutes=sum(b.minutes for b in blocks),
        average_early_minutes=(
            round(sum(b.minutes for b in early) / len(early)) if early else None
        ),
        by_length=[
            FocusLength(
                planned_minutes=planned,
                blocks=len(group),
                finished=sum(1 for b in group if b.finished),
            )
            for planned, group in sorted(lengths.items())
        ],
    )


@router.get("/focus", response_model=FocusStats)
def focus_stats(
    days: int = Query(default=30, ge=1, le=365),
    today: date | None = Query(default=None),
    db: Session = Depends(get_db),
) -> FocusStats:
    """Focus blocks over the last `days` days, today included."""
    end = today or date.today()
    start = end - timedelta(days=days - 1)
    sessions = db.scalars(
        select(WorkSession).where(
            WorkSession.log_date >= start.isoformat(),
            WorkSession.log_date <= end.isoformat(),
            WorkSession.planned_end.is_not(None),
            WorkSession.ended_at.is_not(None),
        )
    ).all()
    blocks = [b for b in (to_block(s) for s in sessions) if b is not None]
    return summarise(blocks, start, end)
