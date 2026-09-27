"""Yes/no habits — pure functions, no database.

DECISION (chosen with the user): on a day a habit applies to, NO TICK MEANS
NOT DONE. The one exception is today, which is still open: an unticked today
neither counts nor breaks a streak until the day is over.

A habit applies on a day when the day is on or after its start date and its
weekday is in the habit's active days. Days it does not apply to are skipped
entirely — they never break a streak, like inactive days for categories.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from scoring import day_code, parse_day_codes

# done / missed: the habit applied and was / was not ticked
# open: today, applies, not ticked yet
# off: the habit does not apply that day (weekday, or before it started)
# future: after today
DayState = str


@dataclass(frozen=True)
class HabitRule:
    """What decides whether a habit applies on a day."""

    start: date
    active_days: frozenset[str]

    @classmethod
    def of(cls, start: str, active_days: str) -> HabitRule:
        """Build from the stored ISO start date and day-code string."""
        return cls(date.fromisoformat(start), parse_day_codes(active_days))

    def applies(self, day: date) -> bool:
        """Whether the habit is expected on this day."""
        return day >= self.start and day_code(day) in self.active_days


def state_on(rule: HabitRule, day: date, checked: set[date], today: date) -> DayState:
    """Return the state of one day."""
    if day > today:
        return "future"
    if day in checked:
        # A tick on a day it does not apply still reads as done: extra effort
        # is recorded, it just never counts against you when absent.
        return "done"
    if not rule.applies(day):
        return "off"
    return "open" if day == today else "missed"


def current_streak(rule: HabitRule, checked: set[date], today: date) -> int:
    """Count consecutive applicable days done.

    The run ends today, or yesterday while today is still open.
    """
    streak = 0
    day = today
    while day >= rule.start:
        state = state_on(rule, day, checked, today)
        if state == "done" and rule.applies(day):
            streak += 1
        elif state == "missed":
            break
        day -= timedelta(days=1)
    return streak


def best_streak(rule: HabitRule, checked: set[date], today: date) -> int:
    """Longest run of applicable days done, up to today."""
    best = run = 0
    day = rule.start
    while day <= today:
        state = state_on(rule, day, checked, today)
        if state == "done" and rule.applies(day):
            run += 1
            best = max(best, run)
        elif state == "missed":
            run = 0
        day += timedelta(days=1)
    return best


@dataclass(frozen=True)
class Rate:
    """Applicable days done over a window (today excluded while open)."""

    done: int
    applicable: int

    @property
    def percent(self) -> float | None:
        """Done as a percentage of applicable days, or None if none applied."""
        if self.applicable == 0:
            return None
        return round(100 * self.done / self.applicable, 1)


def rate(
    rule: HabitRule, checked: set[date], start: date, end: date, today: date
) -> Rate:
    """Done over applicable days between start and end inclusive."""
    done = applicable = 0
    day = start
    while day <= min(end, today):
        state = state_on(rule, day, checked, today)
        if rule.applies(day) and state != "open":
            applicable += 1
            if state == "done":
                done += 1
        day += timedelta(days=1)
    return Rate(done=done, applicable=applicable)
