"""Pure scoring logic — par scores, effective targets, warning streaks.

Deliberately free of ORM objects and database sessions: every function here
takes plain values, which is what makes the rules testable on their own and
keeps the interpretation decisions in one readable file.

Each DECISION below was confirmed with the user; they are marked so a future
reader can tell a deliberate rule from an accident of implementation.

DECISION (par window): 7 CALENDAR days ending YESTERDAY. Today is excluded
  because it is still in progress and would drag par down every morning.
DECISION (tracking start): days before the tracking start date are excluded
  from BOTH the numerator and the denominator.
DECISION (targets are effective-dated): a day is scored against the target
  that applied ON THAT DAY. Changing a target today never rewrites the past.
DECISION (overrides): a non-null override makes a date count for that category
  even if the weekday is not scheduled. An override of 0 opts a day out.
DECISION (missing rows): a day with no record, on a day that counts, is 0
  minutes against the full target. Absence is a zero, not an excuse.
DECISION (warning streak): walking backward from yesterday, a day that does
  not count is SKIPPED — it neither extends nor ends the streak.
DECISION (day total): hand-entered minutes PLUS timed session minutes. The two
  are recorded separately but scored as one number.
DECISION (question targets): a category with a question target (DSA: 2
  questions or 120 minutes, whichever comes first) is credited with the FURTHER
  of the two routes, never their sum. Each question is worth
  target_minutes / question_target minutes (120 / 2 = 60), so 1 question and
  30 minutes credits 60 minutes = 50% — not 90.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import date, timedelta

DAY_CODES: tuple[str, ...] = ("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN")


# --- Inputs ------------------------------------------------------------------


@dataclass(frozen=True)
class TargetRule:
    """A target and schedule, in force from `effective_from` onward."""

    effective_from: date
    daily_target_minutes: int
    active_day_codes: frozenset[str]
    # Optional alternative finish line in questions solved; None for
    # minutes-only categories.
    question_target: int | None = None

    def is_active_on(self, day: date) -> bool:
        """Whether this rule schedules work on `day`."""
        return day_code(day) in self.active_day_codes


@dataclass(frozen=True)
class DayRecord:
    """What is recorded for one category on one date."""

    # CREDITED minutes: what scoring counts. For most categories this is just
    # hand-entered plus timed minutes; for a question-target category it is
    # the further of that and the questions' minute-equivalent.
    minutes: int = 0
    override_target: int | None = None
    # Real minutes worked, for totals and "best day" — never inflated by
    # question credit. None means "same as `minutes`".
    actual_minutes: int | None = None
    questions: int = 0

    @property
    def real_minutes(self) -> int:
        """Minutes actually worked, ignoring any question credit."""
        return self.minutes if self.actual_minutes is None else self.actual_minutes


@dataclass(frozen=True)
class ScoringConfig:
    """Everything tunable that scoring depends on.

    Passed in rather than imported so the Settings page can change these at
    runtime, and so tests can vary them without touching global state.
    """

    tracking_start: date
    par_window_days: int = 7
    par_includes_today: bool = False
    warning_threshold: float = 80.0
    critical_threshold: float = 50.0
    warning_days: int = 2
    critical_days: int = 3


class TargetSchedule:
    """The history of targets for one category, resolvable by date."""

    def __init__(self, rules: Sequence[TargetRule]) -> None:
        # Newest first, so resolution is a simple scan.
        self._rules = sorted(rules, key=lambda r: r.effective_from, reverse=True)

    def for_date(self, day: date) -> TargetRule | None:
        """Return the rule in force on `day`.

        None when the category did not exist yet on that date.
        """
        for rule in self._rules:
            if rule.effective_from <= day:
                return rule
        return None

    @property
    def current(self) -> TargetRule | None:
        """The most recent rule, regardless of date."""
        return self._rules[0] if self._rules else None

    def as_of(self, day: date) -> TargetRule | None:
        """Alias for `for_date`, for call sites where it reads better."""
        return self.for_date(day)


@dataclass
class CategoryScoring:
    """A category's identity plus the inputs scoring needs for it."""

    category_id: int
    name: str
    schedule: TargetSchedule
    records: dict[str, DayRecord] = field(default_factory=dict)


# --- Primitives --------------------------------------------------------------


def day_code(day: date) -> str:
    """Three-letter day code for a date (Monday-indexed)."""
    return DAY_CODES[day.weekday()]


def parse_day_codes(active_days: str) -> frozenset[str]:
    """Parse a comma-separated day-code string into a set."""
    return frozenset(
        part.strip().upper() for part in active_days.split(",") if part.strip()
    )


def date_range(start: date, end: date) -> list[date]:
    """Inclusive list of dates from `start` to `end`."""
    if end < start:
        return []
    return [start + timedelta(days=offset) for offset in range((end - start).days + 1)]


def credited_minutes(minutes: int, questions: int, rule: TargetRule | None) -> int:
    """Minutes to credit a day with, given any questions solved.

    The further of the two routes, never the sum: questions convert at
    target_minutes / question_target each, against the rule in force that day.
    A category without a question target is credited its minutes unchanged.
    """
    if rule is None or not rule.question_target or questions <= 0:
        return minutes
    question_minutes = questions * rule.daily_target_minutes // rule.question_target
    return max(minutes, question_minutes)


def daily_percent(minutes: int, target: int) -> float:
    """Percent of a single day's target achieved.

    A target of 0 (an override that zeroes the day out) is treated as fully
    met — there was nothing to miss.
    """
    if target <= 0:
        return 100.0
    return (minutes / target) * 100.0


def effective_target(
    schedule: TargetSchedule,
    day: date,
    record: DayRecord | None,
    config: ScoringConfig,
) -> tuple[int, bool]:
    """Resolve the target that applies to one category on one date.

    Returns `(target_minutes, counts)`. `counts` is False when the day should
    be left out of par entirely — it predates tracking, predates the category,
    or the weekday is not scheduled and no override opts it in.
    """
    if day < config.tracking_start:
        return 0, False

    rule = schedule.for_date(day)
    if rule is None:
        # The category did not exist yet on this date.
        return 0, False

    if record is not None and record.override_target is not None:
        # An override always makes the day count, scheduled or not.
        return record.override_target, True

    if rule.is_active_on(day):
        return rule.daily_target_minutes, True

    return 0, False


# --- Windows -----------------------------------------------------------------


def par_window_bounds(
    today: date, config: ScoringConfig, offset_windows: int = 0
) -> tuple[date, date]:
    """Bounds of a par window, as `(start, end)`, both inclusive.

    `offset_windows=0` is the current window; `1` is the window immediately
    before it (used for the trend indicator).
    """
    end = today if config.par_includes_today else today - timedelta(days=1)
    end -= timedelta(days=config.par_window_days * offset_windows)
    start = end - timedelta(days=config.par_window_days - 1)
    return start, end


# --- Aggregates --------------------------------------------------------------


@dataclass(frozen=True)
class ParResult:
    """The outcome of scoring one window."""

    par_percent: float | None
    days_counted: int
    minutes_total: int
    target_total: int


def compute_par(
    schedule: TargetSchedule,
    records: dict[str, DayRecord],
    start: date,
    end: date,
    config: ScoringConfig,
) -> ParResult:
    """Par over a date window.

    `par_percent` is None when no day in the window counted for this category,
    which is the correct "no score yet" signal rather than a misleading 0%.
    """
    minutes_total = 0
    target_total = 0
    days_counted = 0

    for day in date_range(start, end):
        record = records.get(day.isoformat())
        target, counts = effective_target(schedule, day, record, config)
        if not counts:
            continue
        days_counted += 1
        target_total += target
        minutes_total += record.minutes if record is not None else 0

    if days_counted == 0:
        return ParResult(None, 0, 0, 0)
    if target_total == 0:
        # Every counted day was overridden to a 0 target — nothing was
        # required, so the window is fully met by definition.
        return ParResult(100.0, days_counted, minutes_total, 0)

    return ParResult(
        (minutes_total / target_total) * 100.0, days_counted, minutes_total, target_total
    )


def consecutive_days_below(
    schedule: TargetSchedule,
    records: dict[str, DayRecord],
    today: date,
    config: ScoringConfig,
) -> int:
    """Count back from yesterday while daily par stays under the threshold.

    Days the category is not active on are stepped over without counting: they
    neither add to the streak nor end it. Stops at the first *active* day that
    meets the threshold, or at the tracking start date.
    """
    streak = 0
    cursor = today if config.par_includes_today else today - timedelta(days=1)

    while cursor >= config.tracking_start:
        record = records.get(cursor.isoformat())
        target, counts = effective_target(schedule, cursor, record, config)
        if not counts:
            cursor -= timedelta(days=1)
            continue
        minutes = record.minutes if record is not None else 0
        if daily_percent(minutes, target) >= config.warning_threshold:
            break
        streak += 1
        cursor -= timedelta(days=1)

    return streak


def status_for(par_percent: float | None, streak: int, config: ScoringConfig) -> str:
    """Map a par score and warning streak onto a visual status.

    Warning at `warning_days` consecutive days below the threshold; critical
    below `critical_threshold` par outright, or at `critical_days` consecutive.
    """
    if par_percent is None and streak == 0:
        return "none"
    if streak >= config.critical_days or (
        par_percent is not None and par_percent < config.critical_threshold
    ):
        return "critical"
    if streak >= config.warning_days:
        return "warning"
    return "healthy"


def trend_for(current: float | None, previous: float | None) -> str:
    """Direction of travel versus the previous window."""
    if current is None or previous is None:
        return "none"
    delta = current - previous
    if abs(delta) < 0.05:
        return "flat"
    return "up" if delta > 0 else "down"


# --- Batch 4: longer-horizon analytics --------------------------------------


def mean(values: Sequence[float]) -> float:
    """Arithmetic mean, 0.0 for an empty sequence."""
    return sum(values) / len(values) if values else 0.0


def stdev(values: Sequence[float]) -> float:
    """Return the population standard deviation; 0.0 for fewer than two values."""
    if len(values) < 2:
        return 0.0
    avg = mean(values)
    return (sum((v - avg) ** 2 for v in values) / len(values)) ** 0.5


def moving_average(values: Sequence[float | None], window: int) -> list[float | None]:
    """Trailing moving average, None until the window is full.

    Entries that are None (days that do not count) are skipped rather than
    treated as zero, so a rest day never drags the line down.
    """
    out: list[float | None] = []
    buffer: list[float] = []
    for value in values:
        if value is not None:
            buffer.append(value)
        if len(buffer) > window:
            buffer.pop(0)
        out.append(mean(buffer) if len(buffer) == window else None)
    return out


def longest_streak_at_or_above(
    schedule: TargetSchedule,
    records: dict[str, DayRecord],
    start: date,
    end: date,
    config: ScoringConfig,
) -> int:
    """Longest run of counted days at or above the warning threshold."""
    best = 0
    current = 0
    for day in date_range(start, end):
        record = records.get(day.isoformat())
        target, counts = effective_target(schedule, day, record, config)
        if not counts:
            continue
        minutes = record.minutes if record is not None else 0
        if daily_percent(minutes, target) >= config.warning_threshold:
            current += 1
            best = max(best, current)
        else:
            current = 0
    return best


# --- Batch 5: accountability --------------------------------------------------


def week_start(day: date) -> date:
    """Return the Monday of the ISO week containing `day`."""
    return day - timedelta(days=day.weekday())


@dataclass(frozen=True)
class Pace:
    """What is still required to finish the current week at 100%.

    This is the one number the dashboard could not previously answer: not
    "how am I doing" but "what do I have to do today".
    """

    week_start: str
    week_end: str
    minutes_logged: int
    target_total: int
    # Active days from today to Sunday, today included.
    days_remaining: int
    minutes_remaining: int
    # Even split across the days left. None when no active days remain.
    minutes_per_remaining_day: int | None
    # True once minutes_logged >= target_total.
    on_track: bool
    percent: float


def week_pace(
    schedule: TargetSchedule,
    records: dict[str, DayRecord],
    today: date,
    config: ScoringConfig,
) -> Pace:
    """Progress and remaining requirement for the current ISO week.

    Unlike par, this INCLUDES today and looks forward — it is a plan, not a
    score. Days already past cannot be worked on, so they count toward the
    requirement but never toward `days_remaining`.
    """
    start = week_start(today)
    end = start + timedelta(days=6)

    logged = 0
    target_total = 0
    days_remaining = 0

    for day in date_range(start, end):
        record = records.get(day.isoformat())
        target, counts = effective_target(schedule, day, record, config)
        if not counts:
            continue
        target_total += target
        logged += record.minutes if record is not None else 0
        if day >= today:
            days_remaining += 1

    remaining = max(0, target_total - logged)
    per_day = (
        None
        if days_remaining == 0
        else -(-remaining // days_remaining)  # ceiling division
    )

    return Pace(
        week_start=start.isoformat(),
        week_end=end.isoformat(),
        minutes_logged=logged,
        target_total=target_total,
        days_remaining=days_remaining,
        minutes_remaining=remaining,
        minutes_per_remaining_day=per_day,
        on_track=remaining == 0,
        percent=(logged / target_total * 100.0) if target_total else 100.0,
    )


@dataclass(frozen=True)
class Records:
    """Personal bests. Facts about what you have done, not points."""

    current_streak: int
    longest_streak: int
    best_day: str | None
    best_day_minutes: int
    best_week: str | None
    best_week_minutes: int
    total_minutes: int
    days_tracked: int


def current_streak_at_or_above(
    schedule: TargetSchedule,
    records: dict[str, DayRecord],
    today: date,
    config: ScoringConfig,
) -> int:
    """Consecutive active days meeting the threshold, counting back from today.

    Today is included only if it ALREADY meets the threshold — an unfinished
    day never breaks a streak, and never flatters one either.
    """
    streak = 0
    cursor = today

    record = records.get(cursor.isoformat())
    target, counts = effective_target(schedule, cursor, record, config)
    minutes = record.minutes if record is not None else 0
    if not (counts and daily_percent(minutes, target) >= config.warning_threshold):
        cursor -= timedelta(days=1)

    while cursor >= config.tracking_start:
        record = records.get(cursor.isoformat())
        target, counts = effective_target(schedule, cursor, record, config)
        if not counts:
            cursor -= timedelta(days=1)
            continue
        minutes = record.minutes if record is not None else 0
        if daily_percent(minutes, target) < config.warning_threshold:
            break
        streak += 1
        cursor -= timedelta(days=1)

    return streak


def compute_records(
    schedule: TargetSchedule,
    records: dict[str, DayRecord],
    today: date,
    config: ScoringConfig,
) -> Records:
    """Lifetime bests for one category."""
    best_day: str | None = None
    best_day_minutes = 0
    total = 0
    days_tracked = 0
    weekly: dict[str, int] = {}

    for iso, record in records.items():
        day = date.fromisoformat(iso)
        if day < config.tracking_start or day > today:
            continue
        _, counts = effective_target(schedule, day, record, config)
        if counts:
            days_tracked += 1
        # Real minutes, not question credit: two questions in 40 minutes is a
        # 40-minute day, however well it scored.
        worked = record.real_minutes
        total += worked
        if worked > best_day_minutes:
            best_day_minutes = worked
            best_day = iso
        key = week_start(day).isoformat()
        weekly[key] = weekly.get(key, 0) + worked

    best_week, best_week_minutes = (None, 0)
    for iso, minutes in weekly.items():
        if minutes > best_week_minutes:
            best_week, best_week_minutes = iso, minutes

    return Records(
        current_streak=current_streak_at_or_above(schedule, records, today, config),
        longest_streak=longest_streak_at_or_above(
            schedule, records, config.tracking_start, today, config
        ),
        best_day=best_day,
        best_day_minutes=best_day_minutes,
        best_week=best_week,
        best_week_minutes=best_week_minutes,
        total_minutes=total,
        days_tracked=days_tracked,
    )
