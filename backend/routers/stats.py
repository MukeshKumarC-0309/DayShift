"""Derived statistics for the dashboard, day detail and long-horizon insights.

Nothing here is stored — every value is computed from the logs and sessions on
each request. The rules live in scoring.py; this module assembles them into
responses.

Worth knowing: the warning streak steps over days a category is not active on,
so a bad Wednesday and a bad Friday read as 2 consecutive days even though an
inactive Thursday sits between them. The streak counts days you were scheduled
to work, not calendar days.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

import repository
import scoring
import sessions_service as svc
import settings_store
from auth import require_auth
from database import get_db
from models import Category, DailyLog
from models import Session as WorkSession
from schemas import (
    CalendarCategory,
    CalendarDay,
    CategoryComparison,
    ConsistencyStat,
    DashboardOut,
    DayCategoryDetail,
    DayDetail,
    HourStat,
    InsightsOut,
    ParScore,
    PeriodSummary,
    RangeCategory,
    RangePoint,
    TodayProgress,
    WeekdayStat,
    WeeklyCategory,
    WeeklyDay,
)
from scoring import DAY_CODES, ScoringConfig

router = APIRouter(
    prefix="/api/stats", tags=["stats"], dependencies=[Depends(require_auth)]
)


def _category_out(db: Session, category: Category, today: date) -> dict[str, object]:
    schedule = repository.target_schedule(db, category.id)
    rule = schedule.for_date(today) or schedule.current
    return {
        "id": category.id,
        "name": category.name,
        "display_order": category.display_order,
        "archived": category.is_archived,
        "daily_target_minutes": rule.daily_target_minutes if rule else 0,
        "active_days": ",".join(
            code for code in DAY_CODES if rule and code in rule.active_day_codes
        ),
        "group_name": category.group_name,
        "question_target": rule.question_target if rule else None,
    }


# --- Today -------------------------------------------------------------------


def _today_progress(
    db: Session, category: Category, today: date, config: ScoringConfig
) -> TodayProgress:
    schedule = repository.target_schedule(db, category.id)
    manual, timed = repository.split_minutes(db, category.id, today)
    log = db.scalar(
        select(DailyLog).where(
            DailyLog.category_id == category.id,
            DailyLog.log_date == today.isoformat(),
        )
    )
    rule = schedule.for_date(today)
    questions = log.questions_solved if log else 0
    worked = manual + timed
    credited = scoring.credited_minutes(worked, questions, rule)
    record = scoring.DayRecord(
        minutes=credited,
        override_target=log.override_target_minutes if log else None,
        actual_minutes=worked,
        questions=questions,
    )
    target, counts = scoring.effective_target(schedule, today, record, config)

    return TodayProgress(
        category_id=category.id,
        category_name=category.name,
        minutes_logged=worked,
        manual_minutes=manual,
        timed_minutes=timed,
        questions_solved=questions,
        question_target=rule.question_target if rule else None,
        credited_minutes=credited,
        target_minutes=target,
        default_target_minutes=rule.daily_target_minutes if rule else 0,
        has_override=log is not None and log.override_target_minutes is not None,
        is_active_today=counts,
        percent=scoring.daily_percent(credited, target) if counts else 0.0,
    )


def _par_score(
    db: Session, category: Category, today: date, config: ScoringConfig
) -> ParScore:
    start, end = scoring.par_window_bounds(today, config)
    prev_start, prev_end = scoring.par_window_bounds(today, config, offset_windows=1)

    schedule = repository.target_schedule(db, category.id)
    # One load spanning both windows plus the streak walk-back.
    records = repository.day_records(
        db, category.id, prev_start - timedelta(days=60), end
    )

    current = scoring.compute_par(schedule, records, start, end, config)
    previous = scoring.compute_par(schedule, records, prev_start, prev_end, config)
    streak = scoring.consecutive_days_below(schedule, records, today, config)

    return ParScore(
        category_id=category.id,
        category_name=category.name,
        par_percent=round(current.par_percent, 1)
        if current.par_percent is not None
        else None,
        previous_par_percent=round(previous.par_percent, 1)
        if previous.par_percent is not None
        else None,
        trend=scoring.trend_for(current.par_percent, previous.par_percent),
        days_counted=current.days_counted,
        minutes_total=current.minutes_total,
        target_total=current.target_total,
        consecutive_days_below=streak,
        status=scoring.status_for(current.par_percent, streak, config),
        window_start=start.isoformat() if current.days_counted else None,
        window_end=end.isoformat() if current.days_counted else None,
    )


def _weekly(
    db: Session, category: Category, today: date, config: ScoringConfig, span: int
) -> WeeklyCategory:
    start = today - timedelta(days=span - 1)
    schedule = repository.target_schedule(db, category.id)
    records = repository.day_records(db, category.id, start, today)

    days: list[WeeklyDay] = []
    for day in scoring.date_range(start, today):
        record = records.get(day.isoformat())
        target, counts = scoring.effective_target(schedule, day, record, config)
        minutes = record.minutes if record else 0
        days.append(
            WeeklyDay(
                log_date=day.isoformat(),
                weekday=scoring.day_code(day),
                minutes_logged=minutes,
                questions=record.questions if record else 0,
                target_minutes=target,
                has_override=record is not None and record.override_target is not None,
                is_active=counts,
                is_tracked=day >= config.tracking_start,
                percent=scoring.daily_percent(minutes, target) if counts else None,
            )
        )
    return WeeklyCategory(category_id=category.id, category_name=category.name, days=days)


@router.get("/dashboard", response_model=DashboardOut)
def dashboard(
    today: date | None = Query(
        default=None,
        description="Override 'today' — for inspecting a past day, not used by the UI.",
    ),
    db: Session = Depends(get_db),
) -> DashboardOut:
    """Everything the dashboard renders, in a single round trip.

    Bundled deliberately: the gauges, par scores and weekly chart read the same
    rows, so separate endpoints would multiply the queries and risk the panels
    disagreeing across a midnight rollover.
    """
    reference = today or date.today()
    config = settings_store.scoring_config(db)
    span = settings_store.load_all(db)["weekly_view_days"]
    categories = repository.active_categories(db)
    running = svc.running_session(db)

    return DashboardOut(
        today=reference.isoformat(),
        tracking_start_date=config.tracking_start.isoformat(),
        progress=[_today_progress(db, c, reference, config) for c in categories],
        par=[_par_score(db, c, reference, config) for c in categories],
        weekly=[_weekly(db, c, reference, config, span) for c in categories],
        categories=[_category_out(db, c, reference) for c in categories],  # type: ignore[misc]
        running=svc.to_out(running) if running else None,
    )


@router.get("/par", response_model=list[ParScore])
def par_scores(
    today: date | None = Query(default=None), db: Session = Depends(get_db)
) -> list[ParScore]:
    """Return the rolling par score per category, with trend and status."""
    reference = today or date.today()
    config = settings_store.scoring_config(db)
    return [
        _par_score(db, c, reference, config) for c in repository.active_categories(db)
    ]


@router.get("/weekly", response_model=list[WeeklyCategory])
def weekly_view(
    today: date | None = Query(default=None), db: Session = Depends(get_db)
) -> list[WeeklyCategory]:
    """Return the last N days per category for the bar chart, including today."""
    reference = today or date.today()
    config = settings_store.scoring_config(db)
    span = settings_store.load_all(db)["weekly_view_days"]
    return [
        _weekly(db, c, reference, config, span) for c in repository.active_categories(db)
    ]


# --- Batch 3: one day in full -------------------------------------------------


@router.get("/day/{log_date}", response_model=DayDetail)
def day_detail(log_date: date, db: Session = Depends(get_db)) -> DayDetail:
    """Every session, note and total recorded on one date."""
    config = settings_store.scoring_config(db)
    categories = repository.active_categories(db, include_archived=True)
    all_sessions = svc.sessions_for_day(db, log_date)
    by_category: dict[int, list[WorkSession]] = defaultdict(list)
    for session in all_sessions:
        by_category[session.category_id].append(session)

    details: list[DayCategoryDetail] = []
    for category in categories:
        manual, timed = repository.split_minutes(db, category.id, log_date)
        sessions = by_category.get(category.id, [])
        if (
            not sessions
            and manual == 0
            and timed == 0
            and repository.questions_on(db, category.id, log_date) == 0
            and category.is_archived
        ):
            continue

        log = db.scalar(
            select(DailyLog).where(
                DailyLog.category_id == category.id,
                DailyLog.log_date == log_date.isoformat(),
            )
        )
        schedule = repository.target_schedule(db, category.id)
        rule = schedule.for_date(log_date)
        questions = log.questions_solved if log else 0
        credited = scoring.credited_minutes(manual + timed, questions, rule)
        record = scoring.DayRecord(
            minutes=credited,
            override_target=log.override_target_minutes if log else None,
            actual_minutes=manual + timed,
            questions=questions,
        )
        target, counts = scoring.effective_target(schedule, log_date, record, config)

        details.append(
            DayCategoryDetail(
                category_id=category.id,
                category_name=category.name,
                manual_minutes=manual,
                timed_minutes=timed,
                questions_solved=questions,
                question_target=rule.question_target if rule else None,
                total_minutes=manual + timed,
                target_minutes=target,
                is_active=counts,
                has_override=log is not None and log.override_target_minutes is not None,
                override_reason=log.override_reason if log else None,
                percent=scoring.daily_percent(credited, target) if counts else None,
                sessions=[svc.to_out(s) for s in sessions],
            )
        )

    return DayDetail(
        log_date=log_date.isoformat(),
        weekday=scoring.day_code(log_date),
        is_tracked=log_date >= config.tracking_start,
        categories=details,
    )


# --- Batch 4: longer horizons -------------------------------------------------


@router.get("/calendar", response_model=list[CalendarCategory])
def calendar(
    start: date = Query(...),
    end: date = Query(...),
    db: Session = Depends(get_db),
) -> list[CalendarCategory]:
    """Per-day totals over an arbitrary range, for the heatmap."""
    if end < start:
        raise HTTPException(status_code=422, detail="end must not precede start")
    if (end - start).days > 400:
        raise HTTPException(status_code=422, detail="Range is limited to 400 days")

    config = settings_store.scoring_config(db)
    out: list[CalendarCategory] = []

    for category in repository.active_categories(db):
        schedule = repository.target_schedule(db, category.id)
        records = repository.day_records(db, category.id, start, end)
        days: list[CalendarDay] = []
        for day in scoring.date_range(start, end):
            record = records.get(day.isoformat())
            target, counts = scoring.effective_target(schedule, day, record, config)
            minutes = record.minutes if record else 0
            days.append(
                CalendarDay(
                    log_date=day.isoformat(),
                    minutes=minutes,
                    target_minutes=target,
                    percent=scoring.daily_percent(minutes, target) if counts else None,
                    is_active=counts,
                    is_tracked=day >= config.tracking_start,
                    has_override=record is not None
                    and record.override_target is not None,
                )
            )
        out.append(
            CalendarCategory(
                category_id=category.id, category_name=category.name, days=days
            )
        )
    return out


def _weekday_breakdown(
    schedule: scoring.TargetSchedule,
    records: dict[str, scoring.DayRecord],
    start: date,
    end: date,
    config: ScoringConfig,
) -> list[WeekdayStat]:
    buckets: dict[str, list[int]] = {code: [0, 0, 0] for code in DAY_CODES}
    for day in scoring.date_range(start, end):
        record = records.get(day.isoformat())
        target, counts = scoring.effective_target(schedule, day, record, config)
        if not counts:
            continue
        bucket = buckets[scoring.day_code(day)]
        bucket[0] += 1
        bucket[1] += record.minutes if record else 0
        bucket[2] += target

    return [
        WeekdayStat(
            weekday=code,
            days_counted=buckets[code][0],
            minutes_total=buckets[code][1],
            target_total=buckets[code][2],
            percent=(buckets[code][1] / buckets[code][2] * 100.0)
            if buckets[code][2]
            else None,
        )
        for code in DAY_CODES
    ]


def _consistency(
    category: Category,
    schedule: scoring.TargetSchedule,
    records: dict[str, scoring.DayRecord],
    start: date,
    end: date,
    config: ScoringConfig,
) -> ConsistencyStat:
    """How evenly the work is spread.

    180 minutes every day and 1260 in one sitting produce the same par; they
    are not the same habit. The score is 100 minus the coefficient of
    variation, clamped — high means steady.
    """
    percents: list[float] = []
    best_day: str | None = None
    best_minutes = 0

    for day in scoring.date_range(start, end):
        record = records.get(day.isoformat())
        target, counts = scoring.effective_target(schedule, day, record, config)
        if not counts:
            continue
        minutes = record.minutes if record else 0
        percents.append(scoring.daily_percent(minutes, target))
        if minutes > best_minutes:
            best_minutes = minutes
            best_day = day.isoformat()

    average = scoring.mean(percents)
    deviation = scoring.stdev(percents)
    coefficient = (deviation / average * 100.0) if average > 0 else 0.0
    score = max(0.0, min(100.0, 100.0 - coefficient))

    return ConsistencyStat(
        category_id=category.id,
        category_name=category.name,
        days_counted=len(percents),
        mean_percent=round(average, 1),
        stdev_percent=round(deviation, 1),
        consistency_score=round(score, 1) if percents else 0.0,
        longest_streak=scoring.longest_streak_at_or_above(
            schedule, records, start, end, config
        ),
        best_day=best_day,
        best_day_minutes=best_minutes,
    )


def _period_summary(
    label: str,
    schedule: scoring.TargetSchedule,
    records: dict[str, scoring.DayRecord],
    start: date,
    end: date,
    config: ScoringConfig,
) -> PeriodSummary:
    result = scoring.compute_par(schedule, records, start, end, config)
    return PeriodSummary(
        label=label,
        start=start.isoformat(),
        end=end.isoformat(),
        minutes_total=result.minutes_total,
        target_total=result.target_total,
        par_percent=round(result.par_percent, 1)
        if result.par_percent is not None
        else None,
        days_counted=result.days_counted,
    )


@router.get("/insights", response_model=InsightsOut)
def insights(
    days: int = Query(default=30, ge=7, le=400),
    today: date | None = Query(default=None),
    average_window: int = Query(default=7, ge=2, le=60),
    db: Session = Depends(get_db),
) -> InsightsOut:
    """Return the long-horizon view for a range.

    Covers daily series with moving averages, weekday and hour patterns,
    consistency, and a comparison against the preceding period of equal length.
    """
    reference = today or date.today()
    config = settings_store.scoring_config(db)

    end = reference
    start = end - timedelta(days=days - 1)
    prev_end = start - timedelta(days=1)
    prev_start = prev_end - timedelta(days=days - 1)

    categories = repository.active_categories(db)
    range_categories: list[RangeCategory] = []
    comparisons: list[CategoryComparison] = []

    for category in categories:
        schedule = repository.target_schedule(db, category.id)
        records = repository.day_records(db, category.id, prev_start, end)

        percents: list[float | None] = []
        points_raw: list[tuple[str, int, int, float | None]] = []
        for day in scoring.date_range(start, end):
            record = records.get(day.isoformat())
            target, counts = scoring.effective_target(schedule, day, record, config)
            minutes = record.minutes if record else 0
            percent = scoring.daily_percent(minutes, target) if counts else None
            percents.append(percent)
            points_raw.append((day.isoformat(), minutes, target, percent))

        averages = scoring.moving_average(percents, average_window)
        points = [
            RangePoint(
                log_date=iso,
                minutes=minutes,
                target_minutes=target,
                percent=round(percent, 1) if percent is not None else None,
                moving_average=round(avg, 1) if avg is not None else None,
            )
            for (iso, minutes, target, percent), avg in zip(
                points_raw, averages, strict=True
            )
        ]

        current = scoring.compute_par(schedule, records, start, end, config)
        current_summary = _period_summary(
            "current", schedule, records, start, end, config
        )
        previous_summary = _period_summary(
            "previous", schedule, records, prev_start, prev_end, config
        )
        delta = (
            round(current_summary.par_percent - previous_summary.par_percent, 1)
            if current_summary.par_percent is not None
            and previous_summary.par_percent is not None
            else None
        )

        range_categories.append(
            RangeCategory(
                category_id=category.id,
                category_name=category.name,
                points=points,
                par_percent=round(current.par_percent, 1)
                if current.par_percent is not None
                else None,
                minutes_total=current.minutes_total,
                target_total=current.target_total,
                days_counted=current.days_counted,
                weekday_breakdown=_weekday_breakdown(
                    schedule, records, start, end, config
                ),
                consistency=_consistency(category, schedule, records, start, end, config),
            )
        )
        comparisons.append(
            CategoryComparison(
                category_id=category.id,
                category_name=category.name,
                current=current_summary,
                previous=previous_summary,
                delta_percent=delta,
            )
        )

    # Time-of-day distribution. Includes any finished session that carries a
    # real clock time — every timer session, plus manual ones the user gave a
    # start time for. Manual sessions with no time are stored at exactly
    # midnight as a sentinel and are skipped, because piling them on hour 0
    # would invent a pattern that was never recorded.
    hour_totals: dict[int, int] = dict.fromkeys(range(24), 0)
    finished = db.scalars(
        select(WorkSession).where(
            WorkSession.log_date >= start.isoformat(),
            WorkSession.log_date <= end.isoformat(),
            WorkSession.ended_at.is_not(None),
        )
    ).all()
    for session in finished:
        if session.source != "timer" and session.started_at[11:19] == "00:00:00":
            continue
        hour_totals[svc.parse_iso(session.started_at).hour] += session.minutes

    return InsightsOut(
        start=start.isoformat(),
        end=end.isoformat(),
        days=days,
        categories=range_categories,
        hours=[HourStat(hour=h, minutes=m) for h, m in sorted(hour_totals.items())],
        comparison=comparisons,
    )
