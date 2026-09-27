"""Finding sessions: search by note, branch or tag, and time per tag."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

import sessions_service as svc
from auth import require_auth
from database import get_db
from models import Category, SessionTag, Tag
from models import Session as WorkSession
from schemas import SearchHit, TagOut, TagRollup, TagRollupRow

router = APIRouter(
    prefix="/api/sessions", tags=["sessions"], dependencies=[Depends(require_auth)]
)


@router.get("/tags/all", response_model=list[TagOut])
def list_tags(db: Session = Depends(get_db)) -> list[TagOut]:
    """Every tag, with how much time it accounts for."""
    rows = db.execute(
        select(
            Tag.id,
            Tag.name,
            func.count(SessionTag.session_id),
            func.coalesce(func.sum(WorkSession.minutes), 0),
        )
        .outerjoin(SessionTag, SessionTag.tag_id == Tag.id)
        .outerjoin(WorkSession, WorkSession.id == SessionTag.session_id)
        .group_by(Tag.id, Tag.name)
        .order_by(func.coalesce(func.sum(WorkSession.minutes), 0).desc())
    ).all()
    return [
        TagOut(
            id=r[0], name=r[1], session_count=int(r[2] or 0), total_minutes=int(r[3] or 0)
        )
        for r in rows
    ]


def _like_pattern(text: str) -> str:
    """Escape LIKE's wildcards so "100%" or "a_b" match literally."""
    escaped = text.lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


@router.get("/search", response_model=list[SearchHit])
def search_sessions(
    q: str = Query(default="", max_length=100),
    tag: str | None = Query(default=None, max_length=48),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> list[SearchHit]:
    """Search session notes, branch/issue references and tags, newest first.

    `q` is a case-insensitive substring of the note, the reference or any tag; `tag`
    requires that exact tag. Give either or both. A plain substring match —
    with one person's history it stays fast without an FTS index.
    """
    text = q.strip()
    tag_name = (tag or "").strip().lower()
    if not text and not tag_name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Give some text to search for, or a tag.",
        )
    stmt = select(WorkSession, Category.name).join(
        Category, Category.id == WorkSession.category_id
    )
    if text:
        needle = _like_pattern(text)
        matching_tag_ids = (
            select(SessionTag.session_id)
            .join(Tag)
            .where(func.lower(Tag.name).like(needle, escape="\\"))
        )
        stmt = stmt.where(
            or_(
                func.lower(func.coalesce(WorkSession.note, "")).like(needle, escape="\\"),
                func.lower(func.coalesce(WorkSession.git_ref, "")).like(
                    needle, escape="\\"
                ),
                WorkSession.id.in_(matching_tag_ids),
            )
        )
    if tag_name:
        stmt = stmt.where(
            WorkSession.id.in_(
                select(SessionTag.session_id).join(Tag).where(Tag.name == tag_name)
            )
        )
    stmt = stmt.order_by(WorkSession.started_at.desc()).limit(limit)
    return [
        SearchHit(session=svc.to_out(session), category_name=name)
        for session, name in db.execute(stmt).all()
    ]


@router.get("/tags/rollup", response_model=TagRollup)
def tag_rollup(
    start: date = Query(...),
    end: date = Query(...),
    db: Session = Depends(get_db),
) -> TagRollup:
    """Time per tag between two dates, inclusive, from finished sessions."""
    if end < start:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="The period ends before it starts.",
        )
    in_period = (
        WorkSession.log_date >= start.isoformat(),
        WorkSession.log_date <= end.isoformat(),
        WorkSession.ended_at.is_not(None),
    )
    total = db.scalar(
        select(func.coalesce(func.sum(WorkSession.minutes), 0)).where(*in_period)
    )
    tagged_ids = select(SessionTag.session_id)
    untagged = db.scalar(
        select(func.coalesce(func.sum(WorkSession.minutes), 0)).where(
            *in_period, WorkSession.id.not_in(tagged_ids)
        )
    )
    rows = db.execute(
        select(
            Tag.name,
            WorkSession.category_id,
            func.count(WorkSession.id),
            func.coalesce(func.sum(WorkSession.minutes), 0),
        )
        .join(SessionTag, SessionTag.tag_id == Tag.id)
        .join(WorkSession, WorkSession.id == SessionTag.session_id)
        .where(*in_period)
        .group_by(Tag.name, WorkSession.category_id)
    ).all()

    branch_rows = db.execute(
        select(
            WorkSession.git_ref,
            WorkSession.category_id,
            func.count(WorkSession.id),
            func.coalesce(func.sum(WorkSession.minutes), 0),
        )
        .where(*in_period, WorkSession.git_ref.is_not(None))
        .group_by(WorkSession.git_ref, WorkSession.category_id)
    ).all()
    return TagRollup(
        start=start.isoformat(),
        end=end.isoformat(),
        total_minutes=int(total or 0),
        untagged_minutes=int(untagged or 0),
        tags=_rollup_rows(rows),
        branches=_rollup_rows(branch_rows),
    )


def _rollup_rows(rows: Sequence[Any]) -> list[TagRollupRow]:
    """(name, category_id, sessions, minutes) groups into rows, longest first."""
    counts: dict[str, int] = {}
    minutes_by_name: dict[str, int] = {}
    by_category: dict[str, dict[int, int]] = {}
    for name, category_id, count, minutes in rows:
        counts[name] = counts.get(name, 0) + int(count)
        minutes_by_name[name] = minutes_by_name.get(name, 0) + int(minutes)
        by_category.setdefault(name, {})[category_id] = int(minutes)
    out = [
        TagRollupRow(
            name=name,
            session_count=counts[name],
            total_minutes=minutes_by_name[name],
            by_category=dict(sorted(by_category[name].items(), key=lambda kv: -kv[1])),
        )
        for name in counts
    ]
    out.sort(key=lambda row: (-row.total_minutes, row.name))
    return out
