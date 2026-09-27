"""Loading layer between the ORM and the pure scoring functions.

Scoring takes plain values (TargetSchedule, DayRecord) rather than ORM
objects. This module is the one place that knows how to turn database rows
into those values, including two rules: a day's minutes are hand-entered
minutes PLUS timed session minutes, and a question-target category is credited
the further of its minutes and its questions (see scoring.credited_minutes).

Applying the credit here, once, is what lets every score downstream — par,
pace, streaks, the heatmap, insights — handle DSA without knowing it exists.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from models import Category, CategoryTarget, DailyLog
from models import Session as WorkSession
from scoring import (
    CategoryScoring,
    DayRecord,
    TargetRule,
    TargetSchedule,
    credited_minutes,
    parse_day_codes,
)


def active_categories(db: Session, include_archived: bool = False) -> list[Category]:
    """Categories in display order, archived ones excluded by default."""
    stmt = select(Category)
    if not include_archived:
        stmt = stmt.where(Category.archived_at.is_(None))
    return list(db.scalars(stmt.order_by(Category.display_order, Category.id)).all())


def target_schedule(db: Session, category_id: int) -> TargetSchedule:
    """Load the full target history for one category."""
    rows = db.scalars(
        select(CategoryTarget).where(CategoryTarget.category_id == category_id)
    ).all()
    return TargetSchedule(
        [
            TargetRule(
                effective_from=date.fromisoformat(row.effective_from),
                daily_target_minutes=row.daily_target_minutes,
                active_day_codes=parse_day_codes(row.active_days),
                question_target=row.question_target,
            )
            for row in rows
        ]
    )


def session_minutes_by_date(
    db: Session, category_id: int, start: date, end: date
) -> dict[str, int]:
    """Sum timed minutes per date for one category.

    Running sessions contribute 0 — their minutes are only fixed when stopped,
    so a live timer never inflates a score mid-session.
    """
    rows = db.execute(
        select(WorkSession.log_date, func.sum(WorkSession.minutes))
        .where(
            WorkSession.category_id == category_id,
            WorkSession.log_date >= start.isoformat(),
            WorkSession.log_date <= end.isoformat(),
            WorkSession.ended_at.is_not(None),
        )
        .group_by(WorkSession.log_date)
    ).all()
    return {row[0]: int(row[1] or 0) for row in rows}


def day_records(
    db: Session, category_id: int, start: date, end: date
) -> dict[str, DayRecord]:
    """Build combined per-date records for one category over a window.

    A date appears if it has a hand-entered log row, a finished session, or
    both. Minutes are the sum of the two; the override comes from the log row.
    """
    logs = db.scalars(
        select(DailyLog).where(
            DailyLog.category_id == category_id,
            DailyLog.log_date >= start.isoformat(),
            DailyLog.log_date <= end.isoformat(),
        )
    ).all()
    timed = session_minutes_by_date(db, category_id, start, end)
    schedule = target_schedule(db, category_id)

    records: dict[str, DayRecord] = {}
    for log in logs:
        worked = log.minutes_logged + timed.get(log.log_date, 0)
        questions = log.questions_solved or 0
        rule = schedule.for_date(date.fromisoformat(log.log_date))
        records[log.log_date] = DayRecord(
            minutes=credited_minutes(worked, questions, rule),
            override_target=log.override_target_minutes,
            actual_minutes=worked,
            questions=questions,
        )
    for day, minutes in timed.items():
        if day not in records:
            records[day] = DayRecord(
                minutes=minutes, override_target=None, actual_minutes=minutes
            )
    return records


def questions_on(db: Session, category_id: int, day: date) -> int:
    """Questions solved for one category on one date."""
    value = db.scalar(
        select(DailyLog.questions_solved).where(
            DailyLog.category_id == category_id,
            DailyLog.log_date == day.isoformat(),
        )
    )
    return int(value or 0)


def category_scoring(
    db: Session, category: Category, start: date, end: date
) -> CategoryScoring:
    """Everything scoring needs for one category over one window."""
    return CategoryScoring(
        category_id=category.id,
        name=category.name,
        schedule=target_schedule(db, category.id),
        records=day_records(db, category.id, start, end),
    )


def split_minutes(db: Session, category_id: int, day: date) -> tuple[int, int]:
    """`(manual_minutes, timed_minutes)` for one category on one date.

    Kept separate for display: the log form shows what the timer already
    captured so hand-entered minutes are never double-counted on top of it.
    """
    log = db.scalar(
        select(DailyLog).where(
            DailyLog.category_id == category_id,
            DailyLog.log_date == day.isoformat(),
        )
    )
    timed = db.scalar(
        select(func.sum(WorkSession.minutes)).where(
            WorkSession.category_id == category_id,
            WorkSession.log_date == day.isoformat(),
            WorkSession.ended_at.is_not(None),
        )
    )
    return (log.minutes_logged if log else 0), int(timed or 0)


def log_row(db: Session, category_id: int, day: str) -> DailyLog | None:
    """Return the hand-entered row for one (date, category), if any."""
    return db.scalar(
        select(DailyLog).where(
            DailyLog.log_date == day, DailyLog.category_id == category_id
        )
    )


def bump_questions(db: Session, category_id: int, day: str, delta: int) -> None:
    """Add to (or take from) a day's question count. Does not commit.

    Used by the problem log so logging a problem counts it. Taking away never
    goes below zero: the count may have been edited by hand in the meantime,
    and a negative count would be meaningless.
    """
    log = log_row(db, category_id, day)
    if log is None:
        if delta <= 0:
            return
        log = DailyLog(log_date=day, category_id=category_id, minutes_logged=0)
        log.questions_solved = 0
        db.add(log)
    log.questions_solved = max(0, (log.questions_solved or 0) + delta)


def question_category(db: Session) -> Category | None:
    """Return the category problems are logged against by default.

    That is the first active category whose current target has a question
    target (DSA).
    """
    for category in active_categories(db):
        rule = target_schedule(db, category.id).current
        if rule is not None and rule.question_target:
            return category
    return None
