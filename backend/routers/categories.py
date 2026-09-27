"""Category management: create, rename, reorder, archive, and retarget.

Targets are never edited in place. Changing one appends a new effective-dated
record, so a day already scored keeps the target that applied when it was
recorded.
"""

from __future__ import annotations

import logging
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

import repository
from auth import require_auth
from database import get_db
from models import Category, CategoryTarget, DailyLog
from models import Session as WorkSession
from schemas import (
    CategoryCreate,
    CategoryOut,
    CategoryReorder,
    CategoryUpdate,
    TargetCreate,
    TargetOut,
)
from scoring import DAY_CODES, parse_day_codes
from sessions_service import now_iso

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/categories", tags=["categories"], dependencies=[Depends(require_auth)]
)


def _validate_days(active_days: str) -> str:
    """Normalise and check a comma-separated day-code string."""
    codes = parse_day_codes(active_days)
    unknown = codes - set(DAY_CODES)
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Unknown day codes: {', '.join(sorted(unknown))}",
        )
    if not codes:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A category needs at least one active day.",
        )
    # Store in canonical week order so the value reads predictably.
    return ",".join(code for code in DAY_CODES if code in codes)


def _to_out(db: Session, category: Category, today: date) -> CategoryOut:
    rule = repository.target_schedule(db, category.id).for_date(today)
    current = repository.target_schedule(db, category.id).current
    effective = rule or current
    return CategoryOut(
        id=category.id,
        name=category.name,
        display_order=category.display_order,
        archived=category.is_archived,
        daily_target_minutes=effective.daily_target_minutes if effective else 0,
        active_days=",".join(sorted(effective.active_day_codes, key=DAY_CODES.index))
        if effective
        else "",
        group_name=category.group_name,
        question_target=effective.question_target if effective else None,
    )


@router.get("", response_model=list[CategoryOut])
def list_categories(
    include_archived: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> list[CategoryOut]:
    """List categories in display order, with today's effective target."""
    today = date.today()
    return [
        _to_out(db, category, today)
        for category in repository.active_categories(db, include_archived)
    ]


@router.post("", response_model=CategoryOut, status_code=status.HTTP_201_CREATED)
def create_category(
    payload: CategoryCreate, db: Session = Depends(get_db)
) -> CategoryOut:
    """Create a category together with its opening target."""
    name = payload.name.strip()
    if db.scalar(select(Category).where(Category.name == name)) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A category named {name!r} already exists.",
        )

    active_days = _validate_days(payload.active_days)
    highest = db.scalar(select(func.max(Category.display_order))) or 0

    # A new category joins the last domain unless told otherwise, so adding
    # one never creates a surprise extra page on the dashboard.
    group_name = (payload.group_name or "").strip() or (
        db.scalar(
            select(Category.group_name).order_by(Category.display_order.desc()).limit(1)
        )
        or "Projects"
    )

    category = Category(name=name, display_order=highest + 1, group_name=group_name)
    db.add(category)
    db.flush()
    db.add(
        CategoryTarget(
            category_id=category.id,
            effective_from=(payload.effective_from or date.today()).isoformat(),
            daily_target_minutes=payload.daily_target_minutes,
            active_days=active_days,
            question_target=payload.question_target,
        )
    )
    db.commit()
    logger.info("Created category %r", name)
    return _to_out(db, category, date.today())


@router.patch("/{category_id}", response_model=CategoryOut)
def update_category(
    category_id: int, payload: CategoryUpdate, db: Session = Depends(get_db)
) -> CategoryOut:
    """Rename, reorder, or archive a category."""
    category = db.get(Category, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail="No such category")

    if payload.name is not None:
        name = payload.name.strip()
        clash = db.scalar(
            select(Category).where(Category.name == name, Category.id != category_id)
        )
        if clash is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"A category named {name!r} already exists.",
            )
        category.name = name

    if payload.display_order is not None:
        category.display_order = payload.display_order

    if payload.archived is not None:
        # Archive, never delete: the logs would lose their meaning.
        category.archived_at = now_iso() if payload.archived else None

    if payload.group_name is not None:
        category.group_name = payload.group_name.strip()

    db.commit()
    return _to_out(db, category, date.today())


@router.post("/reorder", response_model=list[CategoryOut])
def reorder_categories(
    payload: CategoryReorder, db: Session = Depends(get_db)
) -> list[CategoryOut]:
    """Set dashboard order from a list of category ids."""
    for position, category_id in enumerate(payload.category_ids):
        category = db.get(Category, category_id)
        if category is not None:
            category.display_order = position
    db.commit()
    today = date.today()
    return [_to_out(db, c, today) for c in repository.active_categories(db)]


@router.get("/{category_id}/targets", response_model=list[TargetOut])
def list_targets(category_id: int, db: Session = Depends(get_db)) -> list[CategoryTarget]:
    """Return the full target history for a category, oldest first."""
    if db.get(Category, category_id) is None:
        raise HTTPException(status_code=404, detail="No such category")
    return list(
        db.scalars(
            select(CategoryTarget)
            .where(CategoryTarget.category_id == category_id)
            .order_by(CategoryTarget.effective_from)
        ).all()
    )


@router.post(
    "/{category_id}/targets",
    response_model=TargetOut,
    status_code=status.HTTP_201_CREATED,
)
def set_target(
    category_id: int, payload: TargetCreate, db: Session = Depends(get_db)
) -> CategoryTarget:
    """Set a category's target from a date onward.

    Defaults to today. Backdating is allowed but rewrites how already-scored
    days are judged, so the UI warns before doing it.
    """
    if db.get(Category, category_id) is None:
        raise HTTPException(status_code=404, detail="No such category")

    active_days = _validate_days(payload.active_days)
    effective_from = (payload.effective_from or date.today()).isoformat()

    # Omitted: keep whatever question target is in force on that date. 0: none.
    if payload.question_target is None:
        prior = repository.target_schedule(db, category_id).for_date(
            date.fromisoformat(effective_from)
        )
        question_target = prior.question_target if prior else None
    else:
        question_target = payload.question_target or None

    existing = db.scalar(
        select(CategoryTarget).where(
            CategoryTarget.category_id == category_id,
            CategoryTarget.effective_from == effective_from,
        )
    )
    if existing is not None:
        # Same start date: replace rather than stack two rules on one day.
        existing.daily_target_minutes = payload.daily_target_minutes
        existing.active_days = active_days
        existing.question_target = question_target
        db.commit()
        return existing

    target = CategoryTarget(
        category_id=category_id,
        effective_from=effective_from,
        daily_target_minutes=payload.daily_target_minutes,
        active_days=active_days,
        question_target=question_target,
    )
    db.add(target)
    db.commit()
    logger.info(
        "Category %s target -> %s min from %s",
        category_id,
        payload.daily_target_minutes,
        effective_from,
    )
    return target


@router.delete(
    "/{category_id}/targets/{target_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_target(
    category_id: int, target_id: int, db: Session = Depends(get_db)
) -> None:
    """Remove one target record.

    Refused when it is the only one, because a category with no target history
    cannot be scored at all.
    """
    target = db.get(CategoryTarget, target_id)
    if target is None or target.category_id != category_id:
        raise HTTPException(status_code=404, detail="No such target")

    remaining = db.scalar(
        select(func.count(CategoryTarget.id)).where(
            CategoryTarget.category_id == category_id
        )
    )
    if (remaining or 0) <= 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A category must keep at least one target record.",
        )

    db.delete(target)
    db.commit()


@router.get("/{category_id}/usage")
def category_usage(category_id: int, db: Session = Depends(get_db)) -> dict[str, int]:
    """How much history a category has — shown before archiving it."""
    if db.get(Category, category_id) is None:
        raise HTTPException(status_code=404, detail="No such category")
    logs = db.scalar(
        select(func.count(DailyLog.id)).where(DailyLog.category_id == category_id)
    )
    sessions = db.scalar(
        select(func.count(WorkSession.id)).where(WorkSession.category_id == category_id)
    )
    minutes = db.scalar(
        select(func.sum(WorkSession.minutes)).where(
            WorkSession.category_id == category_id
        )
    )
    return {
        "log_rows": int(logs or 0),
        "sessions": int(sessions or 0),
        "timed_minutes": int(minutes or 0),
    }
