"""The monthly letter: a month summed up from everything already stored.

Nothing here is stored or scored — the letter is recomputed from the logs,
check-ins, problems, milestones, habits, deadlines and plans each time it is
opened, so it always agrees with the data. The current month reads up to
yesterday and is marked in progress.
"""

from __future__ import annotations

import calendar
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

import habit_rules
import repository
import scoring
import settings_store
from auth import require_auth
from database import get_db
from models import (
    CheckIn,
    Deadline,
    Habit,
    Milestone,
    PlanMinutes,
    Problem,
    ProblemReview,
)
from models import Session as WorkSession
from schemas import (
    ExamPrep,
    LetterCategory,
    LetterHabit,
    LetterOut,
    MilestoneOut,
    YearCategory,
    YearMonth,
    YearOut,
)

router = APIRouter(
    prefix="/api/letter", tags=["letter"], dependencies=[Depends(require_auth)]
)


def _bounds(month: str) -> tuple[date, date]:
    try:
        year, number = (int(part) for part in month.split("-"))
        start = date(year, number, 1)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="month must look like 2026-10",
        ) from exc
    return start, date(year, number, calendar.monthrange(year, number)[1])


def _real_total(db: Session, start: date, end: date) -> int:
    total = 0
    for category in repository.active_categories(db, include_archived=True):
        records = repository.day_records(db, category.id, start, end)
        total += sum(r.real_minutes for r in records.values())
    return total


def _studied(db: Session, deadline_id: int) -> int:
    """All finished session minutes linked to one exam."""
    total = db.scalar(
        select(func.sum(WorkSession.minutes)).where(
            WorkSession.deadline_id == deadline_id, WorkSession.ended_at.is_not(None)
        )
    )
    return int(total or 0)


@router.get("/months", response_model=list[str])
def months(db: Session = Depends(get_db)) -> list[str]:
    """Every month from tracking start to now, newest first."""
    today = date.today()
    # Before tracking starts there is still the current month to read.
    first = min(settings_store.scoring_config(db).tracking_start, today)
    out: list[str] = []
    cursor = date(first.year, first.month, 1)
    while cursor <= today:
        out.append(f"{cursor.year:04d}-{cursor.month:02d}")
        cursor = date(cursor.year + cursor.month // 12, cursor.month % 12 + 1, 1)
    return list(reversed(out))


@router.get("/{month}", response_model=LetterOut)
def letter(month: str, db: Session = Depends(get_db)) -> LetterOut:
    """One month, summed up."""
    start, month_end = _bounds(month)
    today = date.today()
    if start > today:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="That month has not started",
        )
    in_progress = month_end >= today
    end = min(month_end, today - timedelta(days=1))
    config = settings_store.scoring_config(db)

    # --- Minutes, per category ----------------------------------------------
    categories: list[LetterCategory] = []
    per_day: dict[str, int] = {}
    total = 0
    for category in repository.active_categories(db):
        schedule = repository.target_schedule(db, category.id)
        records = (
            repository.day_records(db, category.id, start, end) if end >= start else {}
        )
        minutes = target_total = credited = on_target = owed = 0
        best_day, best_minutes = None, 0
        for day in scoring.date_range(start, end) if end >= start else []:
            key = day.isoformat()
            record = records.get(key)
            real = record.real_minutes if record else 0
            minutes += real
            per_day[key] = per_day.get(key, 0) + real
            if real > best_minutes:
                best_day, best_minutes = key, real
            target, counts = scoring.effective_target(schedule, day, record, config)
            if counts and target > 0:
                owed += 1
                target_total += target
                got = record.minutes if record else 0
                credited += got
                if got >= target:
                    on_target += 1
        total += minutes
        categories.append(
            LetterCategory(
                category_id=category.id,
                category_name=category.name,
                minutes=minutes,
                target_total=target_total,
                credited_total=credited,
                completion=round(credited / target_total, 3) if target_total else None,
                days_on_target=on_target,
                days_owed=owed,
                best_day=best_day,
                best_day_minutes=best_minutes,
            )
        )

    # Best Monday-start week, counting only its days inside the month.
    weeks: dict[str, int] = {}
    for key, minutes in per_day.items():
        monday = scoring.week_start(date.fromisoformat(key)).isoformat()
        weeks[monday] = weeks.get(monday, 0) + minutes
    best_week = max(weeks.items(), key=lambda kv: kv[1], default=(None, 0))

    previous_end = start - timedelta(days=1)
    previous_start = date(previous_end.year, previous_end.month, 1)

    # --- Check-ins ------------------------------------------------------------
    span_days = (end - start).days + 1 if end >= start else 0
    checkins = list(
        db.scalars(
            select(CheckIn).where(
                CheckIn.check_date >= start.isoformat(),
                CheckIn.check_date <= end.isoformat(),
            )
        )
    )
    sleeps = [c.sleep_minutes for c in checkins if c.sleep_minutes is not None]
    energies = [c.energy for c in checkins if c.energy is not None]

    # --- Practice ---------------------------------------------------------------
    problems = list(
        db.scalars(
            select(Problem).where(
                Problem.solved_on >= start.isoformat(),
                Problem.solved_on <= end.isoformat(),
            )
        )
    )
    reviews = list(
        db.scalars(
            select(ProblemReview).where(
                ProblemReview.reviewed_on >= start.isoformat(),
                ProblemReview.reviewed_on <= end.isoformat(),
            )
        )
    )

    # --- Milestones, habits, exams, plans -------------------------------------
    milestones = list(
        db.scalars(
            select(Milestone)
            .where(
                Milestone.done_on >= start.isoformat(),
                Milestone.done_on <= end.isoformat(),
            )
            .order_by(Milestone.done_on)
        )
    )
    habits: list[LetterHabit] = []
    for habit in db.scalars(select(Habit).options(selectinload(Habit.checks))):
        rule = habit_rules.HabitRule.of(habit.start_date, habit.active_days)
        checked = {date.fromisoformat(c.check_date) for c in habit.checks}
        window = habit_rules.rate(rule, checked, start, end, today)
        if window.applicable:
            habits.append(
                LetterHabit(
                    name=habit.name, done=window.done, applicable=window.applicable
                )
            )
    exam_rows = list(
        db.scalars(
            select(Deadline)
            .where(
                Deadline.kind == "exam",
                Deadline.due_date >= start.isoformat(),
                Deadline.due_date <= month_end.isoformat(),
            )
            .order_by(Deadline.due_date)
        )
    )
    exams = [f"{d.title} ({d.due_date})" for d in exam_rows]
    exam_prep = [
        ExamPrep(title=d.title, due_date=d.due_date, minutes=_studied(db, d.id))
        for d in exam_rows
    ]
    planned: dict[tuple[str, int], int] = {
        (p.plan_date, p.category_id): p.minutes
        for p in db.scalars(
            select(PlanMinutes).where(
                PlanMinutes.plan_date >= start.isoformat(),
                PlanMinutes.plan_date <= end.isoformat(),
            )
        )
    }
    planned_days = {day for day, _ in planned}
    kept_planned = kept_actual = 0
    for (day, category_id), minutes in planned.items():
        record = repository.day_records(
            db, category_id, date.fromisoformat(day), date.fromisoformat(day)
        ).get(day)
        kept_planned += minutes
        kept_actual += min(record.real_minutes if record else 0, minutes)

    return LetterOut(
        month=month,
        start=start.isoformat(),
        end=end.isoformat() if end >= start else start.isoformat(),
        in_progress=in_progress,
        total_minutes=total,
        previous_total_minutes=_real_total(db, previous_start, previous_end),
        best_week_start=best_week[0],
        best_week_minutes=best_week[1],
        categories=categories,
        checkins=len(checkins),
        checkin_gaps=max(0, span_days - len(checkins)),
        average_sleep_minutes=round(sum(sleeps) / len(sleeps)) if sleeps else None,
        average_energy=round(sum(energies) / len(energies), 1) if energies else None,
        problems_solved=len(problems),
        revisions=len(reviews),
        forgotten=sum(1 for r in reviews if r.outcome == "forgot"),
        topics=sorted({p.topic for p in problems}),
        milestones_done=[MilestoneOut.model_validate(m) for m in milestones],
        habits=habits,
        exams=exams,
        planned_days=len(planned_days),
        plan_kept_percent=(
            round(100 * kept_actual / kept_planned, 1) if kept_planned else None
        ),
        exam_prep=exam_prep,
    )


@router.get("/year/{year}", response_model=YearOut)
def year_in_review(year: int, db: Session = Depends(get_db)) -> YearOut:
    """Sum up a calendar year from its monthly letters (so the two agree)."""
    today = date.today()
    if year > today.year or year < 2000:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Pick a year that has started",
        )
    letters = []
    for number in range(1, 13):
        if date(year, number, 1) > today:
            break
        letters.append(letter(f"{year:04d}-{number:02d}", db))

    by_category: dict[int, YearCategory] = {}
    credited: dict[int, int] = {}
    owed: dict[int, int] = {}
    habits: dict[str, LetterHabit] = {}
    sleep_weighted = sleep_days = 0
    for month in letters:
        for c in month.categories:
            row = by_category.setdefault(
                c.category_id,
                YearCategory(
                    category_id=c.category_id,
                    category_name=c.category_name,
                    minutes=0,
                    completion=None,
                    days_on_target=0,
                    days_owed=0,
                ),
            )
            row.minutes += c.minutes
            row.days_on_target += c.days_on_target
            row.days_owed += c.days_owed
            credited[c.category_id] = credited.get(c.category_id, 0) + c.credited_total
            owed[c.category_id] = owed.get(c.category_id, 0) + c.target_total
        for h in month.habits:
            acc = habits.setdefault(
                h.name, LetterHabit(name=h.name, done=0, applicable=0)
            )
            acc.done += h.done
            acc.applicable += h.applicable
        if month.average_sleep_minutes is not None:
            sleep_weighted += month.average_sleep_minutes * month.checkins
            sleep_days += month.checkins
    for category_id, row in by_category.items():
        if owed.get(category_id):
            row.completion = round(credited[category_id] / owed[category_id], 3)

    months = [
        YearMonth(
            month=m.month,
            minutes=m.total_minutes,
            problems_solved=m.problems_solved,
            milestones=len(m.milestones_done),
        )
        for m in letters
    ]
    best = max(months, key=lambda m: m.minutes, default=None)
    return YearOut(
        year=year,
        months=months,
        total_minutes=sum(m.minutes for m in months),
        best_month=best.month if best and best.minutes > 0 else None,
        categories=list(by_category.values()),
        problems_solved=sum(m.problems_solved for m in letters),
        revisions=sum(m.revisions for m in letters),
        milestones_done=[x for m in letters for x in m.milestones_done],
        habits=list(habits.values()),
        checkins=sum(m.checkins for m in letters),
        average_sleep_minutes=round(sleep_weighted / sleep_days) if sleep_days else None,
        exam_prep=[x for m in letters for x in m.exam_prep],
    )
