"""The daily plan: minutes per category plus a task list, set ahead of a day.

Chosen with the user: both. Planned minutes are compared with the real
minutes worked that day (typed + timed); tasks are ticked off. Neither is a
target and neither changes a score — a plan is intent, recorded so the next
day can show intent against what happened.
"""

from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

import repository
import scoring
import settings_store
from auth import require_auth
from database import get_db
from models import Category, Deadline, PlanMinutes, PlanTask
from schemas import (
    DayPlan,
    PlanCategoryRow,
    PlanMinutesSet,
    PlanSuggestion,
    PlanSuggestionItem,
    PlanTaskCreate,
    PlanTaskOut,
    PlanTaskUpdate,
)

router = APIRouter(
    prefix="/api/plan", tags=["plan"], dependencies=[Depends(require_auth)]
)


def worked_minutes(db: Session, category_id: int, day: date) -> int:
    """Real minutes worked on one day (typed + timed), without question credit."""
    record = repository.day_records(db, category_id, day, day).get(day.isoformat())
    return record.real_minutes if record else 0


def _tasks(db: Session, day: str) -> list[PlanTask]:
    return list(
        db.scalars(
            select(PlanTask)
            .where(PlanTask.plan_date == day)
            .order_by(PlanTask.position, PlanTask.id)
        ).all()
    )


@router.get("/{plan_date}", response_model=DayPlan)
def get_plan(plan_date: date, db: Session = Depends(get_db)) -> DayPlan:
    """Return a day's plan, with actual minutes once the day has started."""
    today = date.today()
    key = plan_date.isoformat()
    planned = {
        row.category_id: row.minutes
        for row in db.scalars(select(PlanMinutes).where(PlanMinutes.plan_date == key))
    }
    started = plan_date <= today
    rows = []
    for category in repository.active_categories(db):
        rows.append(
            PlanCategoryRow(
                category_id=category.id,
                category_name=category.name,
                planned=planned.get(category.id),
                actual=worked_minutes(db, category.id, plan_date) if started else None,
            )
        )
    return DayPlan(
        plan_date=key,
        is_past=plan_date < today,
        is_today=plan_date == today,
        categories=rows,
        tasks=[PlanTaskOut.model_validate(t) for t in _tasks(db, key)],
        planned_total=sum(planned.values()),
        actual_total=sum(r.actual or 0 for r in rows) if started else None,
    )


def _round_up_5(minutes: int) -> int:
    return -(-minutes // 5) * 5


@router.get("/{plan_date}/suggest", response_model=PlanSuggestion)
def suggest(plan_date: date, db: Session = Depends(get_db)) -> PlanSuggestion:
    """Pre-fill a day's plan from what its week still needs. Saves nothing.

    Each scheduled category gets its even share of the week's remaining
    requirement (the dashboard's "min/day" pace), rounded up to 5 minutes. A
    day with an override (an exam) gets that override; a rest day gets 0.
    Planning a day in the current week counts from today, so work still
    possible today is not assumed away.
    """
    today = date.today()
    same_week = scoring.week_start(plan_date) == scoring.week_start(today)
    reference = today if same_week and plan_date >= today else plan_date
    config = settings_store.scoring_config(db)
    start = scoring.week_start(reference)
    end = start + timedelta(days=6)

    items: list[PlanSuggestionItem] = []
    for category in repository.active_categories(db):
        schedule = repository.target_schedule(db, category.id)
        records = repository.day_records(db, category.id, start, end)
        record = records.get(plan_date.isoformat())
        target, counts = scoring.effective_target(schedule, plan_date, record, config)
        if not counts:
            minutes, reason = 0, "not scheduled"
        elif record is not None and record.override_target is not None:
            minutes, reason = target, "override for that day"
        else:
            pace = scoring.week_pace(schedule, records, reference, config)
            per_day = pace.minutes_per_remaining_day or 0
            minutes = _round_up_5(per_day)
            reason = (
                "week already met"
                if pace.on_track
                else f"{pace.minutes_remaining} min left over {pace.days_remaining} days"
            )
        items.append(
            PlanSuggestionItem(
                category_id=category.id,
                category_name=category.name,
                minutes=minutes,
                reason=reason,
            )
        )

    soon = plan_date + timedelta(days=3)
    exams = db.scalars(
        select(Deadline).where(
            Deadline.kind == "exam",
            Deadline.done_at.is_(None),
            Deadline.due_date > plan_date.isoformat(),
            Deadline.due_date <= soon.isoformat(),
        )
    ).all()
    return PlanSuggestion(
        plan_date=plan_date.isoformat(),
        items=items,
        upcoming_exams=[
            f"{e.title} in {(date.fromisoformat(e.due_date) - plan_date).days}d"
            for e in exams
        ],
    )


@router.put("/{plan_date}/minutes", response_model=DayPlan)
def set_minutes(
    plan_date: date, payload: PlanMinutesSet, db: Session = Depends(get_db)
) -> DayPlan:
    """Replace a day's planned minutes. 0 removes a category from the plan."""
    key = plan_date.isoformat()
    for item in payload.items:
        if db.get(Category, item.category_id) is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"No category with id {item.category_id}",
            )
    db.execute(delete(PlanMinutes).where(PlanMinutes.plan_date == key))
    for item in payload.items:
        if item.minutes > 0:
            db.add(
                PlanMinutes(
                    plan_date=key, category_id=item.category_id, minutes=item.minutes
                )
            )
    db.commit()
    return get_plan(plan_date, db)


@router.post(
    "/{plan_date}/tasks", response_model=PlanTaskOut, status_code=status.HTTP_201_CREATED
)
def add_task(
    plan_date: date, payload: PlanTaskCreate, db: Session = Depends(get_db)
) -> PlanTask:
    """Add a task at the end of a day's list."""
    key = plan_date.isoformat()
    last = db.scalar(select(func.max(PlanTask.position)).where(PlanTask.plan_date == key))
    task = PlanTask(plan_date=key, text=payload.text.strip(), position=(last or 0) + 1)
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


@router.post("/{plan_date}/carry-over", response_model=list[PlanTaskOut])
def carry_over(plan_date: date, db: Session = Depends(get_db)) -> list[PlanTask]:
    """Copy the previous day's unfinished tasks onto this day.

    Copies rather than moves: yesterday keeps its honest record of what was
    planned and not done. Tasks already on this day are not duplicated.
    """
    key = plan_date.isoformat()
    previous = (plan_date - timedelta(days=1)).isoformat()
    existing = {t.text for t in _tasks(db, key)}
    last = db.scalar(select(func.max(PlanTask.position)).where(PlanTask.plan_date == key))
    position = last or 0
    for task in _tasks(db, previous):
        if task.done or task.text in existing:
            continue
        position += 1
        db.add(PlanTask(plan_date=key, text=task.text, position=position))
    db.commit()
    return _tasks(db, key)


@router.patch("/tasks/{task_id}", response_model=PlanTaskOut)
def update_task(
    task_id: int, payload: PlanTaskUpdate, db: Session = Depends(get_db)
) -> PlanTask:
    """Edit or tick a task."""
    task = db.get(PlanTask, task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No task")
    if payload.text is not None:
        task.text = payload.text.strip()
    if payload.done is not None:
        task.done = payload.done
    db.commit()
    db.refresh(task)
    return task


@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: int, db: Session = Depends(get_db)) -> None:
    """Delete a task."""
    task = db.get(PlanTask, task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No task")
    db.delete(task)
    db.commit()
