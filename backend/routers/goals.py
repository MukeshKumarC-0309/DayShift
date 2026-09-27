"""Goals: project milestones and yes/no habits.

Neither feeds par, pace or any minute-based score. Milestones record what the
time produced; habits are daily yes/no commitments with their own streaks.
See habit_rules.py for the DECISION on unticked days.
"""

from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

import habit_rules
from auth import require_auth
from database import get_db
from models import Category, Habit, HabitCheck, Milestone
from schemas import (
    HabitCheckSet,
    HabitCreate,
    HabitDay,
    HabitOut,
    HabitUpdate,
    MilestoneCreate,
    MilestoneOut,
    MilestoneUpdate,
)
from scoring import DAY_CODES, parse_day_codes
from sessions_service import now_iso

router = APIRouter(
    prefix="/api/goals", tags=["goals"], dependencies=[Depends(require_auth)]
)

HISTORY_DAYS = 14


def _category(db: Session, category_id: int) -> Category:
    category = db.get(Category, category_id)
    if category is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No category with id {category_id}",
        )
    return category


# --- Milestones -------------------------------------------------------------------


@router.get("/milestones", response_model=list[MilestoneOut])
def list_milestones(
    category_id: int | None = Query(default=None),
    done_from: date | None = Query(default=None),
    done_to: date | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[Milestone]:
    """List milestones: open ones first in their order, then done, newest first.

    `done_from` / `done_to` restrict to milestones finished in that range (the
    weekly review and the monthly letter use this).
    """
    stmt = select(Milestone)
    if category_id is not None:
        stmt = stmt.where(Milestone.category_id == category_id)
    if done_from is not None:
        stmt = stmt.where(Milestone.done_on >= done_from.isoformat())
    if done_to is not None:
        stmt = stmt.where(Milestone.done_on <= done_to.isoformat())
    rows = list(db.scalars(stmt).all())
    open_rows = sorted(
        (m for m in rows if m.done_on is None), key=lambda m: m.display_order
    )
    done_rows = sorted(
        (m for m in rows if m.done_on is not None),
        key=lambda m: (m.done_on or "", m.id),
        reverse=True,
    )
    return open_rows + done_rows


@router.post(
    "/milestones", response_model=MilestoneOut, status_code=status.HTTP_201_CREATED
)
def create_milestone(
    payload: MilestoneCreate, db: Session = Depends(get_db)
) -> Milestone:
    """Add an open milestone at the end of its category's list."""
    _category(db, payload.category_id)
    last = db.scalar(
        select(func.max(Milestone.display_order)).where(
            Milestone.category_id == payload.category_id
        )
    )
    milestone = Milestone(
        category_id=payload.category_id,
        title=payload.title.strip(),
        notes=(payload.notes or "").strip() or None,
        display_order=(last or 0) + 1,
    )
    db.add(milestone)
    db.commit()
    db.refresh(milestone)
    return milestone


@router.patch("/milestones/{milestone_id}", response_model=MilestoneOut)
def update_milestone(
    milestone_id: int, payload: MilestoneUpdate, db: Session = Depends(get_db)
) -> Milestone:
    """Edit a milestone. `done: true` finishes it today unless `done_on` is given."""
    milestone = db.get(Milestone, milestone_id)
    if milestone is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No milestone")
    fields = payload.model_fields_set
    if "title" in fields and payload.title is not None:
        milestone.title = payload.title.strip()
    if "notes" in fields:
        milestone.notes = (payload.notes or "").strip() or None
    if "category_id" in fields and payload.category_id is not None:
        _category(db, payload.category_id)
        milestone.category_id = payload.category_id
    if "done_on" in fields and payload.done_on is not None:
        milestone.done_on = payload.done_on.isoformat()
    elif "done" in fields and payload.done is not None:
        milestone.done_on = date.today().isoformat() if payload.done else None
    db.commit()
    db.refresh(milestone)
    return milestone


@router.delete("/milestones/{milestone_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_milestone(milestone_id: int, db: Session = Depends(get_db)) -> None:
    """Delete a milestone."""
    milestone = db.get(Milestone, milestone_id)
    if milestone is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No milestone")
    db.delete(milestone)
    db.commit()


# --- Habits -------------------------------------------------------------------------


def _clean_days(raw: str) -> str:
    codes = parse_day_codes(raw)
    if not codes or not codes <= set(DAY_CODES):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="active_days must be day codes like MON,TUE",
        )
    return ",".join(code for code in DAY_CODES if code in codes)


def _habit_out(habit: Habit, today: date) -> HabitOut:
    rule = habit_rules.HabitRule.of(habit.start_date, habit.active_days)
    checked = {date.fromisoformat(c.check_date) for c in habit.checks}
    days = [
        HabitDay(
            day=(today - timedelta(days=offset)).isoformat(),
            state=habit_rules.state_on(
                rule, today - timedelta(days=offset), checked, today
            ),
        )
        for offset in range(HISTORY_DAYS - 1, -1, -1)
    ]
    window = habit_rules.rate(rule, checked, today - timedelta(days=29), today, today)
    return HabitOut(
        id=habit.id,
        name=habit.name,
        active_days=habit.active_days,
        start_date=habit.start_date,
        archived=habit.archived_at is not None,
        days=days,
        today=habit_rules.state_on(rule, today, checked, today),
        current_streak=habit_rules.current_streak(rule, checked, today),
        best_streak=habit_rules.best_streak(rule, checked, today),
        rate_30=window.percent,
    )


def _habit(db: Session, habit_id: int) -> Habit:
    habit = db.get(Habit, habit_id)
    if habit is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No habit")
    return habit


@router.get("/habits", response_model=list[HabitOut])
def list_habits(
    include_archived: bool = Query(default=False),
    today: date | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[HabitOut]:
    """Habits with their last 14 days, streaks and 30-day rate."""
    reference = today or date.today()
    stmt = (
        select(Habit)
        .options(selectinload(Habit.checks))
        .order_by(Habit.display_order, Habit.id)
    )
    if not include_archived:
        stmt = stmt.where(Habit.archived_at.is_(None))
    return [_habit_out(h, reference) for h in db.scalars(stmt).all()]


@router.post("/habits", response_model=HabitOut, status_code=status.HTTP_201_CREATED)
def create_habit(payload: HabitCreate, db: Session = Depends(get_db)) -> HabitOut:
    """Add a habit.

    It counts from its start date (today by default), never retroactively, so
    adding one never creates a history of misses.
    """
    last = db.scalar(select(func.max(Habit.display_order)))
    habit = Habit(
        name=payload.name.strip(),
        active_days=_clean_days(payload.active_days),
        start_date=(payload.start_date or date.today()).isoformat(),
        display_order=(last or 0) + 1,
    )
    db.add(habit)
    db.commit()
    db.refresh(habit)
    return _habit_out(habit, date.today())


@router.patch("/habits/{habit_id}", response_model=HabitOut)
def update_habit(
    habit_id: int, payload: HabitUpdate, db: Session = Depends(get_db)
) -> HabitOut:
    """Rename, reschedule or archive a habit."""
    habit = _habit(db, habit_id)
    fields = payload.model_fields_set
    if "name" in fields and payload.name is not None:
        habit.name = payload.name.strip()
    if "active_days" in fields and payload.active_days is not None:
        habit.active_days = _clean_days(payload.active_days)
    if "archived" in fields and payload.archived is not None:
        habit.archived_at = now_iso() if payload.archived else None
    db.commit()
    db.refresh(habit)
    return _habit_out(habit, date.today())


@router.delete("/habits/{habit_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_habit(habit_id: int, db: Session = Depends(get_db)) -> None:
    """Delete a habit and every tick it has. Archive to keep the history."""
    db.delete(_habit(db, habit_id))
    db.commit()


@router.put("/habits/{habit_id}/checks/{check_date}", response_model=HabitOut)
def set_check(
    habit_id: int,
    check_date: date,
    payload: HabitCheckSet,
    db: Session = Depends(get_db),
) -> HabitOut:
    """Tick or untick a habit on a day. Future days cannot be ticked."""
    habit = _habit(db, habit_id)
    today = date.today()
    if check_date > today:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A day that has not happened cannot be ticked",
        )
    key = check_date.isoformat()
    existing = next((c for c in habit.checks if c.check_date == key), None)
    if payload.done and existing is None:
        habit.checks.append(HabitCheck(check_date=key))
    elif not payload.done and existing is not None:
        habit.checks.remove(existing)
    db.commit()
    db.refresh(habit)
    return _habit_out(habit, today)
