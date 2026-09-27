"""Agenda: exams, assignments and other dated items, plus the Today line.

DECISION (exam days, chosen with the user): adding an EXAM sets target
overrides on its day automatically. By default every active category gets
0 min; the form lets you change any of them before saving.

The overrides are ordinary `daily_logs` overrides, so par, the weekly chart's
`*` and the honesty ledger treat them exactly like any other — an exam added
for a day already past shows up in the ledger, as it should. Each carries
`override_reason = "Exam: <title>"`.

Moving, retargeting, re-kinding or deleting an exam takes back only the
overrides it set AND that are still as it left them. If you have since edited
that day's override by hand, your edit wins and is left alone.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

import habit_rules
import ics
import practice
import repository
from auth import require_auth
from database import get_db
from models import (
    Category,
    CheckIn,
    DailyLog,
    Deadline,
    DeadlineOverride,
    Habit,
    PlanMinutes,
    PlanTask,
    Problem,
)
from models import Session as WorkSession
from schemas import (
    CheckInOut,
    DeadlineCreate,
    DeadlineOut,
    DeadlineOverrideIn,
    DeadlineUpdate,
    IcsEventOut,
    IcsImportIn,
    TodayHabit,
    TodaySummary,
)
from sessions_service import now_iso

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/agenda", tags=["agenda"], dependencies=[Depends(require_auth)]
)

# How far ahead the dashboard's Today line looks for deadlines.
TODAY_HORIZON_DAYS = 14


def _reason(title: str) -> str:
    return f"Exam: {title}"


def _studied(db: Session, deadline_ids: list[int]) -> dict[int, int]:
    """Finished session minutes per linked exam/deadline."""
    if not deadline_ids:
        return {}
    rows = db.execute(
        select(WorkSession.deadline_id, func.sum(WorkSession.minutes))
        .where(
            WorkSession.deadline_id.in_(deadline_ids),
            WorkSession.ended_at.is_not(None),
        )
        .group_by(WorkSession.deadline_id)
    ).all()
    return {int(did): int(total or 0) for did, total in rows}


def study_pace(target: int | None, studied: int, days_left: int) -> int | None:
    """Minutes a day still needed to reach a study target before the exam.

    Study days are today through the day before (the exam day's own targets
    are the exam's overrides). Rounded up to 5 minutes; 0 once reached; None
    without a target or on/after the day.
    """
    if target is None or days_left <= 0:
        return None
    remaining = max(0, target - studied)
    if remaining == 0:
        return 0
    per_day = -(-remaining // days_left)  # ceiling division
    return -(-per_day // 5) * 5


def _out(deadline: Deadline, today: date, studied: int = 0) -> DeadlineOut:
    days_left = (date.fromisoformat(deadline.due_date) - today).days
    return DeadlineOut(
        id=deadline.id,
        title=deadline.title,
        kind=deadline.kind,
        due_date=deadline.due_date,
        notes=deadline.notes,
        done=deadline.done_at is not None,
        days_left=days_left,
        overrides=[
            DeadlineOverrideIn(category_id=o.category_id, target_minutes=o.target_minutes)
            for o in sorted(deadline.overrides, key=lambda o: o.category_id)
        ],
        studied_minutes=studied,
        study_target_minutes=deadline.study_target_minutes,
        needed_per_day=study_pace(deadline.study_target_minutes, studied, days_left),
    )


def _get(db: Session, deadline_id: int) -> Deadline:
    deadline = db.get(Deadline, deadline_id)
    if deadline is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"No deadline {deadline_id}"
        )
    return deadline


def _apply(db: Session, deadline: Deadline) -> None:
    """Write an exam's overrides onto its day. Does not commit."""
    if deadline.kind != "exam":
        return
    stamp = now_iso()
    for item in deadline.overrides:
        log = repository.log_row(db, item.category_id, deadline.due_date)
        if log is None:
            log = DailyLog(
                log_date=deadline.due_date, category_id=item.category_id, minutes_logged=0
            )
            log.questions_solved = 0
            db.add(log)
        if log.override_target_minutes != item.target_minutes:
            log.override_set_at = stamp
        log.override_target_minutes = item.target_minutes
        log.override_reason = _reason(deadline.title)


def _take_back(
    db: Session, day: str, title: str, overrides: list[tuple[int, int]], kind: str
) -> None:
    """Clear overrides an exam set, if they are still exactly as it set them."""
    if kind != "exam":
        return
    for category_id, target in overrides:
        log = repository.log_row(db, category_id, day)
        if log is None:
            continue
        if log.override_target_minutes == target and log.override_reason == _reason(
            title
        ):
            log.override_target_minutes = None
            log.override_reason = None
            log.override_set_at = None


def _set_overrides(
    db: Session, deadline: Deadline, items: list[DeadlineOverrideIn] | None
) -> None:
    """Replace a deadline's override list; an exam with none gets the default."""
    if items is None and deadline.kind == "exam" and not deadline.overrides:
        items = [
            DeadlineOverrideIn(category_id=c.id, target_minutes=0)
            for c in repository.active_categories(db)
        ]
    if items is None:
        return
    for item in items:
        if db.get(Category, item.category_id) is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"No category with id {item.category_id}",
            )
    seen: set[int] = set()
    deadline.overrides.clear()
    db.flush()
    for item in items:
        if item.category_id in seen:
            continue
        seen.add(item.category_id)
        deadline.overrides.append(
            DeadlineOverride(
                category_id=item.category_id, target_minutes=item.target_minutes
            )
        )


@router.get("/deadlines", response_model=list[DeadlineOut])
def list_deadlines(
    include_done: bool = Query(default=False),
    today: date | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[DeadlineOut]:
    """Deadlines by date. Past, finished ones are hidden unless asked for."""
    reference = today or date.today()
    rows = db.scalars(
        select(Deadline)
        .options(selectinload(Deadline.overrides))
        .order_by(Deadline.due_date, Deadline.id)
    ).all()
    studied = _studied(db, [d.id for d in rows])
    out = [_out(d, reference, studied.get(d.id, 0)) for d in rows]
    if not include_done:
        out = [d for d in out if not d.done]
    return out


@router.post(
    "/deadlines", response_model=DeadlineOut, status_code=status.HTTP_201_CREATED
)
def create_deadline(
    payload: DeadlineCreate, db: Session = Depends(get_db)
) -> DeadlineOut:
    """Add a deadline. An exam sets its day's overrides straight away."""
    deadline = Deadline(
        title=payload.title.strip(),
        kind=payload.kind,
        due_date=payload.due_date.isoformat(),
        notes=(payload.notes or "").strip() or None,
        study_target_minutes=payload.study_target_minutes or None,
    )
    db.add(deadline)
    db.flush()
    if deadline.kind == "exam":
        _set_overrides(db, deadline, payload.overrides)
        _apply(db, deadline)
    db.commit()
    db.refresh(deadline)
    logger.info(
        "Deadline %s on %s (%s)", deadline.title, deadline.due_date, deadline.kind
    )
    return _out(deadline, date.today())


@router.patch("/deadlines/{deadline_id}", response_model=DeadlineOut)
def update_deadline(
    deadline_id: int, payload: DeadlineUpdate, db: Session = Depends(get_db)
) -> DeadlineOut:
    """Edit a deadline; an exam's overrides follow its date, title and targets."""
    deadline = _get(db, deadline_id)
    fields = payload.model_fields_set

    before = (
        deadline.due_date,
        deadline.title,
        [(o.category_id, o.target_minutes) for o in deadline.overrides],
        deadline.kind,
    )

    if "title" in fields and payload.title is not None:
        deadline.title = payload.title.strip()
    if "kind" in fields and payload.kind is not None:
        deadline.kind = payload.kind
    if "due_date" in fields and payload.due_date is not None:
        deadline.due_date = payload.due_date.isoformat()
    if "notes" in fields:
        deadline.notes = (payload.notes or "").strip() or None
    if "done" in fields and payload.done is not None:
        deadline.done_at = now_iso() if payload.done else None
    if "study_target_minutes" in fields:
        deadline.study_target_minutes = payload.study_target_minutes or None

    moved = (deadline.due_date, deadline.title, deadline.kind) != (
        before[0],
        before[1],
        before[3],
    )
    if moved or "overrides" in fields:
        _take_back(db, *before)
        if deadline.kind == "exam":
            _set_overrides(
                db, deadline, payload.overrides if "overrides" in fields else None
            )
        _apply(db, deadline)

    db.commit()
    db.refresh(deadline)
    studied = _studied(db, [deadline.id]).get(deadline.id, 0)
    return _out(deadline, date.today(), studied)


@router.delete("/deadlines/{deadline_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_deadline(deadline_id: int, db: Session = Depends(get_db)) -> None:
    """Delete a deadline and take back the exam overrides it set."""
    deadline = _get(db, deadline_id)
    _take_back(
        db,
        deadline.due_date,
        deadline.title,
        [(o.category_id, o.target_minutes) for o in deadline.overrides],
        deadline.kind,
    )
    # Sessions linked to it keep their minutes; they just stop pointing here.
    for session in db.scalars(
        select(WorkSession).where(WorkSession.deadline_id == deadline.id)
    ):
        session.deadline_id = None
    db.delete(deadline)
    db.commit()


@router.get("/today", response_model=TodaySummary)
def today_summary(
    today: date | None = Query(default=None), db: Session = Depends(get_db)
) -> TodaySummary:
    """Return the dashboard's one-line agenda: revisions, deadlines, check-in."""
    reference = today or date.today()

    problems = db.scalars(select(Problem).options(selectinload(Problem.reviews))).all()
    due = 0
    for problem in problems:
        schedule = practice.schedule_for(
            date.fromisoformat(problem.solved_on),
            [
                practice.Revision(date.fromisoformat(r.reviewed_on), r.outcome)
                for r in problem.reviews
            ],
        )
        if schedule.is_due(reference):
            due += 1

    horizon = reference + timedelta(days=TODAY_HORIZON_DAYS)
    deadlines = db.scalars(
        select(Deadline)
        .options(selectinload(Deadline.overrides))
        .where(
            Deadline.done_at.is_(None),
            Deadline.due_date >= reference.isoformat(),
            Deadline.due_date <= horizon.isoformat(),
        )
        .order_by(Deadline.due_date, Deadline.id)
        .limit(3)
    ).all()

    checkin = db.scalar(
        select(CheckIn).where(CheckIn.check_date == reference.isoformat())
    )
    key = reference.isoformat()
    habits = []
    for habit in db.scalars(
        select(Habit)
        .options(selectinload(Habit.checks))
        .where(Habit.archived_at.is_(None))
        .order_by(Habit.display_order, Habit.id)
    ):
        if habit_rules.HabitRule.of(habit.start_date, habit.active_days).applies(
            reference
        ):
            done = any(c.check_date == key for c in habit.checks)
            habits.append(TodayHabit(id=habit.id, name=habit.name, done=done))

    open_tasks = len(
        db.scalars(
            select(PlanTask.id).where(PlanTask.plan_date == key, PlanTask.done.is_(False))
        ).all()
    )
    planned = sum(
        db.scalars(select(PlanMinutes.minutes).where(PlanMinutes.plan_date == key)).all()
    )

    return TodaySummary(
        today=key,
        revisions_due=due,
        deadlines=[
            _out(d, reference, studied)
            for d, studied in zip(
                deadlines,
                [_studied(db, [d.id]).get(d.id, 0) for d in deadlines],
                strict=True,
            )
        ],
        checkin=CheckInOut.model_validate(checkin) if checkin else None,
        habits=habits,
        plan_open_tasks=open_tasks,
        plan_minutes=planned,
    )


# How far ahead an imported calendar is read. Past events are not agenda items.
ICS_HORIZON_DAYS = 365


@router.post("/import-ics", response_model=list[IcsEventOut])
def import_ics(payload: IcsImportIn, db: Session = Depends(get_db)) -> list[IcsEventOut]:
    """Read an .ics file and list its upcoming events. Adds nothing.

    The browser reads the file and sends its text; the response is a preview.
    You choose which events become deadlines (and which are exams) and they are
    added through the ordinary create endpoint — so an imported exam sets its
    day's overrides exactly like a typed one.
    """
    today = date.today()
    horizon = today + timedelta(days=ICS_HORIZON_DAYS)
    existing = {
        (d.title.casefold(), d.due_date) for d in db.scalars(select(Deadline)).all()
    }
    seen: set[tuple[str, str]] = set()
    out: list[IcsEventOut] = []
    for event in sorted(ics.parse(payload.text), key=lambda e: (e.day, e.title)):
        if not today <= event.day <= horizon:
            continue
        key = (event.title.casefold(), event.day.isoformat())
        if key in seen:
            continue
        seen.add(key)
        out.append(
            IcsEventOut(
                uid=event.uid,
                title=event.title,
                day=event.day.isoformat(),
                recurring=event.recurring,
                looks_like_exam=event.looks_like_exam,
                already_added=key in existing,
            )
        )
    return out[:300]
