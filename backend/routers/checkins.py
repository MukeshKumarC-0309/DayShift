"""Daily check-ins: last night's sleep, energy and mood.

Context only. Nothing here feeds par, pace or any score. A day without a
check-in is a gap and is shown as one — never filled in, carried forward, or
averaged over (the user's explicit choice).

The insights endpoint lines check-ins up against how each day went, so a
pattern like "short nights cost me a third of the next day" becomes visible.
"How the day went" is COMPLETION: the share of the day's targets met, with each
category capped at 100% so one long session cannot hide a skipped category.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

import repository
import scoring
import settings_store
from auth import require_auth
from database import get_db
from models import CheckIn
from schemas import (
    CheckInBucket,
    CheckInDay,
    CheckInInsights,
    CheckInOut,
    CheckInSet,
)

router = APIRouter(
    prefix="/api/checkins", tags=["checkins"], dependencies=[Depends(require_auth)]
)


@router.get("", response_model=list[CheckInOut])
def list_checkins(
    start: date = Query(...), end: date = Query(...), db: Session = Depends(get_db)
) -> list[CheckIn]:
    """List stored check-ins in a date range. Missing days are simply absent."""
    return list(
        db.scalars(
            select(CheckIn)
            .where(
                CheckIn.check_date >= start.isoformat(),
                CheckIn.check_date <= end.isoformat(),
            )
            .order_by(CheckIn.check_date)
        ).all()
    )


@router.put("", response_model=CheckInOut)
def set_checkin(payload: CheckInSet, db: Session = Depends(get_db)) -> CheckIn:
    """Create or replace one day's check-in."""
    day = payload.check_date.isoformat()
    row = db.scalar(select(CheckIn).where(CheckIn.check_date == day))
    if row is None:
        row = CheckIn(check_date=day)
        db.add(row)
    row.sleep_minutes = payload.sleep_minutes
    row.energy = payload.energy
    row.mood = payload.mood
    row.note = (payload.note or "").strip() or None
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{check_date}", status_code=status.HTTP_204_NO_CONTENT)
def delete_checkin(check_date: date, db: Session = Depends(get_db)) -> None:
    """Remove a check-in, turning that day back into a gap."""
    row = db.scalar(select(CheckIn).where(CheckIn.check_date == check_date.isoformat()))
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="No check-in for that date"
        )
    db.delete(row)
    db.commit()


def _completion_by_day(db: Session, start: date, end: date) -> dict[str, float]:
    """Share of each day's targets met, per category capped at 100%.

    Days with nothing scheduled (or before tracking began) are left out, so
    they read as "no data" rather than as a perfect or a failed day.
    """
    config = settings_store.scoring_config(db)
    done: dict[str, int] = {}
    owed: dict[str, int] = {}
    for category in repository.active_categories(db):
        schedule = repository.target_schedule(db, category.id)
        records = repository.day_records(db, category.id, start, end)
        for day in scoring.date_range(start, end):
            key = day.isoformat()
            record = records.get(key)
            target, counts = scoring.effective_target(schedule, day, record, config)
            if not counts or target <= 0:
                continue
            owed[key] = owed.get(key, 0) + target
            done[key] = done.get(key, 0) + min(record.minutes if record else 0, target)
    return {key: done[key] / owed[key] for key in owed}


def _bucket(
    label: str,
    rows: list[tuple[CheckIn, float]],
    keep: Callable[[CheckIn], bool],
) -> CheckInBucket:
    values = [completion for checkin, completion in rows if keep(checkin)]
    return CheckInBucket(
        label=label,
        days=len(values),
        completion=round(sum(values) / len(values), 3) if values else None,
    )


@router.get("/insights", response_model=CheckInInsights)
def insights(
    days: int = Query(default=60, ge=7, le=365),
    today: date | None = Query(default=None),
    db: Session = Depends(get_db),
) -> CheckInInsights:
    """Check-ins for the window, gaps included, against how each day went.

    Today is listed (so today's check-in shows) but not scored: it is still in
    progress, the same reason par excludes it.
    """
    reference = today or date.today()
    start = reference - timedelta(days=days - 1)
    scored_end = reference - timedelta(days=1)

    stored = {
        c.check_date: c
        for c in db.scalars(
            select(CheckIn).where(
                CheckIn.check_date >= start.isoformat(),
                CheckIn.check_date <= reference.isoformat(),
            )
        ).all()
    }
    completion = _completion_by_day(db, start, scored_end) if scored_end >= start else {}

    out_days: list[CheckInDay] = []
    paired: list[tuple[CheckIn, float]] = []
    for day in scoring.date_range(start, reference):
        key = day.isoformat()
        checkin = stored.get(key)
        value = completion.get(key)
        out_days.append(
            CheckInDay(
                day=key,
                checkin=CheckInOut.model_validate(checkin) if checkin else None,
                completion=round(value, 3) if value is not None else None,
            )
        )
        if checkin is not None and value is not None:
            paired.append((checkin, value))

    def slept(low: int | None, high: int | None) -> Callable[[CheckIn], bool]:
        def keep(c: CheckIn) -> bool:
            if c.sleep_minutes is None:
                return False
            return (low is None or c.sleep_minutes >= low) and (
                high is None or c.sleep_minutes < high
            )

        return keep

    def energy(values: set[int]) -> Callable[[CheckIn], bool]:
        return lambda c: c.energy in values

    return CheckInInsights(
        start=start.isoformat(),
        end=reference.isoformat(),
        days=out_days,
        gaps=sum(1 for d in out_days if d.checkin is None),
        by_sleep=[
            _bucket("Under 6h", paired, slept(None, 360)),
            _bucket("6-7h", paired, slept(360, 420)),
            _bucket("7-8h", paired, slept(420, 480)),
            _bucket("8h or more", paired, slept(480, None)),
        ],
        by_energy=[
            _bucket("Low (1-2)", paired, energy({1, 2})),
            _bucket("Middling (3)", paired, energy({3})),
            _bucket("High (4-5)", paired, energy({4, 5})),
        ],
    )
