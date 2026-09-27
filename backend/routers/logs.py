"""Daily log routes: read, upsert, and delete hand-entered log entries.

One row per (log_date, category_id) — submitting the same pair twice updates
the existing row rather than inserting a duplicate.

`minutes_logged` here is hand-entered time ONLY. Time measured by the timer
lives in `sessions`; a day is scored on the sum of the two. Keeping them apart
means starting a timer can never silently inflate a total you already typed.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

import repository
from auth import require_auth
from database import get_db
from models import Category, DailyLog
from schemas import BulkOverride, CategoryOut, LogAdjust, LogOut, LogUpsert
from scoring import DAY_CODES
from sessions_service import now_iso

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/logs", tags=["logs"], dependencies=[Depends(require_auth)]
)


@router.get("/categories", response_model=list[CategoryOut])
def list_categories(db: Session = Depends(get_db)) -> list[CategoryOut]:
    """List active categories with the target in force today.

    Kept here as well as under /api/categories so existing clients keep
    working; the richer management endpoints live in the categories router.
    """
    today = date.today()
    out: list[CategoryOut] = []
    for category in repository.active_categories(db):
        schedule = repository.target_schedule(db, category.id)
        rule = schedule.for_date(today) or schedule.current
        out.append(
            CategoryOut(
                id=category.id,
                name=category.name,
                display_order=category.display_order,
                archived=category.is_archived,
                daily_target_minutes=rule.daily_target_minutes if rule else 0,
                active_days=",".join(
                    code for code in DAY_CODES if rule and code in rule.active_day_codes
                ),
                group_name=category.group_name,
                question_target=rule.question_target if rule else None,
            )
        )
    return out


@router.get("", response_model=list[LogOut])
def list_logs(
    start: date | None = Query(default=None, description="Inclusive ISO date"),
    end: date | None = Query(default=None, description="Inclusive ISO date"),
    category_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[DailyLog]:
    """List log entries, optionally filtered by date range and category."""
    stmt = select(DailyLog)
    if start is not None:
        stmt = stmt.where(DailyLog.log_date >= start.isoformat())
    if end is not None:
        stmt = stmt.where(DailyLog.log_date <= end.isoformat())
    if category_id is not None:
        stmt = stmt.where(DailyLog.category_id == category_id)
    stmt = stmt.order_by(DailyLog.log_date.desc(), DailyLog.category_id)
    return list(db.scalars(stmt).all())


@router.get("/day/{log_date}", response_model=list[LogOut])
def logs_for_day(log_date: date, db: Session = Depends(get_db)) -> list[DailyLog]:
    """All log entries for a single date, one per category that has a row."""
    stmt = (
        select(DailyLog)
        .where(DailyLog.log_date == log_date.isoformat())
        .order_by(DailyLog.category_id)
    )
    return list(db.scalars(stmt).all())


@router.put("", response_model=LogOut)
def upsert_log(payload: LogUpsert, db: Session = Depends(get_db)) -> DailyLog:
    """Create or update the log entry for one (date, category).

    Both fields are independently optional so the same endpoint serves three
    uses: logging minutes, setting a target override in advance for a day that
    has not happened yet (the row is created with `minutes_logged = 0`), and
    editing either value on an existing row afterwards.

    Override semantics: omitting `override_target_minutes` leaves any existing
    override untouched; sending `clear_override: true` removes it so the
    scheduled target applies again.
    """
    category = db.get(Category, payload.category_id)
    if category is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No category with id {payload.category_id}",
        )

    iso_date = payload.log_date.isoformat()
    log = db.scalar(
        select(DailyLog).where(
            DailyLog.log_date == iso_date,
            DailyLog.category_id == payload.category_id,
        )
    )

    if log is None:
        log = DailyLog(
            log_date=iso_date,
            category_id=payload.category_id,
            minutes_logged=payload.minutes_logged or 0,
            questions_solved=payload.questions_solved or 0,
        )
        db.add(log)
    else:
        if payload.minutes_logged is not None:
            log.minutes_logged = payload.minutes_logged
        if payload.questions_solved is not None:
            log.questions_solved = payload.questions_solved

    if payload.clear_override:
        log.override_target_minutes = None
        log.override_reason = None
        log.override_set_at = None
    elif payload.override_target_minutes is not None:
        # Stamp when the TARGET changed, separately from `updated_at` which
        # also moves when minutes are edited. The honesty ledger needs to tell
        # an override set in advance from one set after the day was missed.
        if log.override_target_minutes != payload.override_target_minutes:
            log.override_set_at = now_iso()
        log.override_target_minutes = payload.override_target_minutes
        if payload.override_reason is not None:
            log.override_reason = payload.override_reason.strip() or None

    db.commit()
    db.refresh(log)
    return log


@router.post("/adjust", response_model=LogOut)
def adjust_log(payload: LogAdjust, db: Session = Depends(get_db)) -> DailyLog:
    """Add a delta to one day's hand-entered minutes and/or questions.

    Backs the dashboard's quick-add buttons (`+15`, `+30`, `+1 Q`) and their
    undo. The row is created if the day has none yet. Timed minutes are not
    touched — they belong to sessions.
    """
    category = db.get(Category, payload.category_id)
    if category is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No category with id {payload.category_id}",
        )

    iso_date = payload.log_date.isoformat()
    log = db.scalar(
        select(DailyLog).where(
            DailyLog.log_date == iso_date,
            DailyLog.category_id == payload.category_id,
        )
    )
    minutes = (log.minutes_logged if log else 0) + payload.minutes_delta
    questions = (log.questions_solved if log else 0) + payload.questions_delta

    if minutes < 0 or questions < 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="That would take the day below zero",
        )
    if minutes > 1440:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A day has 1440 minutes",
        )
    if questions > 100:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="At most 100 questions a day",
        )

    if log is None:
        log = DailyLog(
            log_date=iso_date,
            category_id=payload.category_id,
            minutes_logged=minutes,
            questions_solved=questions,
        )
        db.add(log)
    else:
        log.minutes_logged = minutes
        log.questions_solved = questions

    db.commit()
    db.refresh(log)
    return log


@router.delete("/{log_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_log(log_id: int, db: Session = Depends(get_db)) -> None:
    """Delete a log entry outright.

    Note this is not the same as logging 0 minutes: a deleted row on an active
    day still counts as 0 against that day's target in par (absence is a zero),
    it simply stops carrying an override.
    """
    log = db.get(DailyLog, log_id)
    if log is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"No log with id {log_id}"
        )
    db.delete(log)
    db.commit()


@router.post("/bulk-override", response_model=list[LogOut])
def bulk_override(payload: BulkOverride, db: Session = Depends(get_db)) -> list[DailyLog]:
    """Apply one override across a date range — an exam week, a trip.

    Setting a fortnight of exam days one at a time is the kind of friction
    that stops a tracker being used at all. By default only days the category
    is actually scheduled on are touched, so a weekend-only category does not
    sprout weekday rows.
    """
    if payload.end < payload.start:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="end must not precede start",
        )
    if (payload.end - payload.start).days > 366:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Range is limited to a year",
        )

    written: list[DailyLog] = []
    stamp = now_iso()

    for category_id in payload.category_ids:
        category = db.get(Category, category_id)
        if category is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"No category with id {category_id}",
            )

        schedule = repository.target_schedule(db, category_id)
        cursor = payload.start
        while cursor <= payload.end:
            rule = schedule.for_date(cursor)
            scheduled = rule is not None and rule.is_active_on(cursor)
            if payload.active_days_only and not scheduled:
                cursor += timedelta(days=1)
                continue

            iso = cursor.isoformat()
            log = db.scalar(
                select(DailyLog).where(
                    DailyLog.log_date == iso, DailyLog.category_id == category_id
                )
            )
            if log is None:
                log = DailyLog(log_date=iso, category_id=category_id, minutes_logged=0)
                db.add(log)

            if log.override_target_minutes != payload.override_target_minutes:
                log.override_set_at = stamp
            log.override_target_minutes = payload.override_target_minutes
            if payload.reason is not None:
                log.override_reason = payload.reason.strip() or None

            written.append(log)
            cursor += timedelta(days=1)

    db.commit()
    for log in written:
        db.refresh(log)
    logger.info(
        "Bulk override %s..%s -> %s min across %s categories",
        payload.start,
        payload.end,
        payload.override_target_minutes,
        len(payload.category_ids),
    )
    return written
