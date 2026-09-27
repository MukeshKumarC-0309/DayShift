"""Batch 5: pace, records, weekly review, commitments and the honesty ledger.

The theme is turning a record of what happened into something that changes
what happens next — without gamifying it. Nothing here awards points; it
reports facts you can act on, and makes one uncomfortable fact visible.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

import repository
import scoring
import settings_store
from auth import require_auth
from database import get_db
from models import Category, Commitment, DailyLog, WeeklyReview
from schemas import (
    CommitmentOut,
    CommitmentSet,
    HonestyLedger,
    LedgerEntry,
    PaceOut,
    RecordsOut,
    ReflectionSet,
    TargetSuggestion,
    WeekCategorySummary,
    WeeklyReviewOut,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/accountability",
    tags=["accountability"],
    dependencies=[Depends(require_auth)],
)


@router.get("/pace", response_model=list[PaceOut])
def pace(
    today: date | None = Query(default=None), db: Session = Depends(get_db)
) -> list[PaceOut]:
    """Return what is still required this week, per category."""
    reference = today or date.today()
    config = settings_store.scoring_config(db)
    start = scoring.week_start(reference)
    end = start + timedelta(days=6)

    out: list[PaceOut] = []
    for category in repository.active_categories(db):
        schedule = repository.target_schedule(db, category.id)
        records = repository.day_records(db, category.id, start, end)
        result = scoring.week_pace(schedule, records, reference, config)
        out.append(
            PaceOut(
                category_id=category.id,
                category_name=category.name,
                week_start=result.week_start,
                week_end=result.week_end,
                minutes_logged=result.minutes_logged,
                target_total=result.target_total,
                days_remaining=result.days_remaining,
                minutes_remaining=result.minutes_remaining,
                minutes_per_remaining_day=result.minutes_per_remaining_day,
                on_track=result.on_track,
                percent=round(result.percent, 1),
            )
        )
    return out


@router.get("/records", response_model=list[RecordsOut])
def records(
    today: date | None = Query(default=None), db: Session = Depends(get_db)
) -> list[RecordsOut]:
    """Return lifetime bests and the current streak, per category."""
    reference = today or date.today()
    config = settings_store.scoring_config(db)

    out: list[RecordsOut] = []
    for category in repository.active_categories(db):
        schedule = repository.target_schedule(db, category.id)
        history = repository.day_records(
            db, category.id, config.tracking_start, reference
        )
        result = scoring.compute_records(schedule, history, reference, config)
        out.append(
            RecordsOut(
                category_id=category.id,
                category_name=category.name,
                current_streak=result.current_streak,
                longest_streak=result.longest_streak,
                best_day=result.best_day,
                best_day_minutes=result.best_day_minutes,
                best_week=result.best_week,
                best_week_minutes=result.best_week_minutes,
                total_minutes=result.total_minutes,
                days_tracked=result.days_tracked,
            )
        )
    return out


def _commitments_for(
    db: Session, start: date, end: date, config: scoring.ScoringConfig
) -> list[CommitmentOut]:
    """Pair committed minutes with what actually happened, for one week."""
    stored = {
        row.category_id: row
        for row in db.scalars(
            select(Commitment).where(Commitment.week_start == start.isoformat())
        ).all()
    }

    out: list[CommitmentOut] = []
    for category in repository.active_categories(db):
        schedule = repository.target_schedule(db, category.id)
        records_map = repository.day_records(db, category.id, start, end)
        result = scoring.compute_par(schedule, records_map, start, end, config)
        committed = stored.get(category.id)
        committed_minutes = committed.minutes if committed else None

        out.append(
            CommitmentOut(
                category_id=category.id,
                category_name=category.name,
                week_start=start.isoformat(),
                committed_minutes=committed_minutes,
                actual_minutes=result.minutes_total,
                target_minutes=result.target_total,
                delta_minutes=(
                    result.minutes_total - committed_minutes
                    if committed_minutes is not None
                    else None
                ),
                kept=(
                    result.minutes_total >= committed_minutes
                    if committed_minutes is not None
                    else None
                ),
            )
        )
    return out


@router.get("/review", response_model=WeeklyReviewOut)
def weekly_review(
    week_start: date | None = Query(default=None),
    today: date | None = Query(default=None),
    db: Session = Depends(get_db),
) -> WeeklyReviewOut:
    """Return one week's numbers, its commitments, and any written reflection.

    Defaults to the week just finished rather than the current one: reviewing
    a week that is still running is guessing.
    """
    reference = today or date.today()
    config = settings_store.scoring_config(db)

    if week_start is not None:
        start = scoring.week_start(week_start)
    else:
        start = scoring.week_start(reference) - timedelta(days=7)
    end = start + timedelta(days=6)

    summaries: list[WeekCategorySummary] = []
    total = 0
    for category in repository.active_categories(db):
        schedule = repository.target_schedule(db, category.id)
        records_map = repository.day_records(db, category.id, start, end)
        result = scoring.compute_par(schedule, records_map, start, end, config)

        best_day: str | None = None
        best_minutes = 0
        for iso, record in records_map.items():
            if record.minutes > best_minutes:
                best_minutes, best_day = record.minutes, iso

        total += result.minutes_total
        summaries.append(
            WeekCategorySummary(
                category_id=category.id,
                category_name=category.name,
                minutes_logged=result.minutes_total,
                target_total=result.target_total,
                percent=round(result.par_percent, 1)
                if result.par_percent is not None
                else None,
                days_counted=result.days_counted,
                best_day=best_day,
                best_day_minutes=best_minutes,
            )
        )

    stored = db.scalar(
        select(WeeklyReview).where(WeeklyReview.week_start == start.isoformat())
    )

    return WeeklyReviewOut(
        week_start=start.isoformat(),
        week_end=end.isoformat(),
        is_current_week=start == scoring.week_start(reference),
        reflection=stored.reflection if stored else "",
        reviewed_at=stored.updated_at if stored else None,
        categories=summaries,
        commitments=_commitments_for(db, start, end, config),
        total_minutes=total,
    )


@router.put("/review", response_model=WeeklyReviewOut)
def save_reflection(
    payload: ReflectionSet,
    today: date | None = Query(default=None),
    db: Session = Depends(get_db),
) -> WeeklyReviewOut:
    """Save the written part of a week's review."""
    start = scoring.week_start(payload.week_start)
    stored = db.scalar(
        select(WeeklyReview).where(WeeklyReview.week_start == start.isoformat())
    )
    if stored is None:
        db.add(WeeklyReview(week_start=start.isoformat(), reflection=payload.reflection))
    else:
        stored.reflection = payload.reflection
    db.commit()
    return weekly_review(week_start=start, today=today, db=db)


@router.put("/commitments", response_model=list[CommitmentOut])
def set_commitment(
    payload: CommitmentSet, db: Session = Depends(get_db)
) -> list[CommitmentOut]:
    """Declare how many minutes you intend to do for a category that week."""
    if db.get(Category, payload.category_id) is None:
        raise HTTPException(status_code=404, detail="No such category")

    start = scoring.week_start(payload.week_start)
    existing = db.scalar(
        select(Commitment).where(
            Commitment.week_start == start.isoformat(),
            Commitment.category_id == payload.category_id,
        )
    )
    if existing is None:
        db.add(
            Commitment(
                week_start=start.isoformat(),
                category_id=payload.category_id,
                minutes=payload.minutes,
            )
        )
    else:
        existing.minutes = payload.minutes
    db.commit()

    config = settings_store.scoring_config(db)
    return _commitments_for(db, start, start + timedelta(days=6), config)


@router.delete(
    "/commitments/{week_start}/{category_id}", status_code=status.HTTP_204_NO_CONTENT
)
def clear_commitment(
    week_start: date, category_id: int, db: Session = Depends(get_db)
) -> None:
    """Remove a commitment."""
    start = scoring.week_start(week_start)
    existing = db.scalar(
        select(Commitment).where(
            Commitment.week_start == start.isoformat(),
            Commitment.category_id == category_id,
        )
    )
    if existing is None:
        raise HTTPException(status_code=404, detail="No such commitment")
    db.delete(existing)
    db.commit()


@router.get("/ledger", response_model=HonestyLedger)
def honesty_ledger(
    today: date | None = Query(default=None), db: Session = Depends(get_db)
) -> HonestyLedger:
    """List overrides applied after the day they govern had already passed.

    The README is explicit that nothing prevents retroactively lowering a
    target to erase a warning, and that this is an accepted trade-off for a
    single-user tool. This endpoint does not change that — it just declines to
    let it happen invisibly. An override set in advance never appears here.
    """
    reference = today or date.today()
    names = {
        c.id: c.name for c in repository.active_categories(db, include_archived=True)
    }

    rows = db.scalars(
        select(DailyLog)
        .where(
            DailyLog.override_target_minutes.is_not(None),
            DailyLog.override_set_at.is_not(None),
        )
        .order_by(DailyLog.log_date.desc())
    ).all()

    entries: list[LedgerEntry] = []
    for row in rows:
        log_date = date.fromisoformat(row.log_date)
        set_at = date.fromisoformat(str(row.override_set_at)[:10])
        # Set in advance, or on the day itself — not retroactive.
        if set_at <= log_date or log_date > reference:
            continue

        schedule = repository.target_schedule(db, row.category_id)
        rule = schedule.for_date(log_date)
        scheduled = rule.daily_target_minutes if rule else 0
        override = row.override_target_minutes or 0

        entries.append(
            LedgerEntry(
                log_date=row.log_date,
                category_id=row.category_id,
                category_name=names.get(row.category_id, f"#{row.category_id}"),
                scheduled_target=scheduled,
                override_target=override,
                minutes_logged=row.minutes_logged,
                override_reason=row.override_reason,
                override_set_at=str(row.override_set_at),
                days_late=(set_at - log_date).days,
                lowered=override < scheduled,
            )
        )

    return HonestyLedger(
        entries=entries,
        total_retroactive=len(entries),
        total_lowered=sum(1 for e in entries if e.lowered),
    )


@router.get("/target-suggestions", response_model=list[TargetSuggestion])
def target_suggestions(
    today: date | None = Query(default=None), db: Session = Depends(get_db)
) -> list[TargetSuggestion]:
    """Categories that have run well above or below target for weeks on end.

    A suggestion only: nothing changes until you apply it, and applying it is
    an ordinary effective-dated target change from next Monday, so no past
    day is rescored. Thresholds and the number of weeks are in Settings.
    Each week is judged on its credited minutes against its targets; a week
    with nothing owed (not yet tracked, all rest days) means no suggestion.
    """
    reference = today or date.today()
    values = settings_store.load_all(db)
    high, low = values["target_review_high"], values["target_review_low"]
    weeks = values["target_review_weeks"]
    config = settings_store.scoring_config(db)
    this_week = scoring.week_start(reference)
    starts = [this_week - timedelta(days=7 * n) for n in range(weeks, 0, -1)]
    next_monday = this_week + timedelta(days=7)

    out: list[TargetSuggestion] = []
    for category in repository.active_categories(db):
        schedule = repository.target_schedule(db, category.id)
        rule = schedule.current
        if rule is None or rule.daily_target_minutes <= 0:
            continue
        records = repository.day_records(
            db, category.id, starts[0], this_week - timedelta(days=1)
        )
        percents: list[float] = []
        credited_total = owed_days = 0
        for start in starts:
            got = owed = 0
            for day in scoring.date_range(start, start + timedelta(days=6)):
                record = records.get(day.isoformat())
                target, counts = scoring.effective_target(schedule, day, record, config)
                if not counts or target <= 0:
                    continue
                owed += target
                owed_days += 1
                got += record.minutes if record else 0
            if owed == 0:
                break
            credited_total += got
            percents.append(round(100 * got / owed, 1))
        if len(percents) < weeks or owed_days == 0:
            continue

        average = credited_total / owed_days
        suggested = max(5, round(average / 5) * 5)
        current = rule.daily_target_minutes
        if all(p >= high for p in percents) and suggested > current:
            direction = "raise"
        elif all(p <= low for p in percents) and suggested < current:
            direction = "lower"
        else:
            continue
        out.append(
            TargetSuggestion(
                category_id=category.id,
                category_name=category.name,
                direction=direction,
                current_target=current,
                suggested_target=suggested,
                active_days=",".join(
                    code for code in scoring.DAY_CODES if code in rule.active_day_codes
                ),
                weekly_percents=percents,
                weeks=[s.isoformat() for s in starts],
                effective_from=next_monday.isoformat(),
            )
        )
    return out
