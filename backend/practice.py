"""Spaced revision for the DSA problem log — pure functions, no database.

DECISION (revision intervals, chosen with the user): a problem comes back
3, 10 and 30 days after it was solved. After the third clean revision it is
considered mastered and stops coming back.

How each revision moves the schedule:
  * solid  — solved cleanly: advance to the next interval
  * shaky  — solved, but with a struggle: repeat the same interval
  * forgot — could not solve it: start again from the first interval
Each revision re-anchors the schedule on the day it happened, so revising
late never makes the next one due "in the past".

DECISION (revisions and the question target): a revision never counts as a
question solved. The DSA question target measures NEW problems; the minutes
spent revising still count as DSA time like any other minutes.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, timedelta

INTERVALS: tuple[int, ...] = (3, 10, 30)
OUTCOMES: tuple[str, ...] = ("solid", "shaky", "forgot")


@dataclass(frozen=True)
class Revision:
    """One revision, reduced to what scheduling needs."""

    reviewed_on: date
    outcome: str


@dataclass(frozen=True)
class Schedule:
    """Where a problem stands in its revision cycle."""

    stage: int  # how many intervals have been passed cleanly
    due_on: date | None  # None once mastered
    mastered: bool

    def overdue_days(self, today: date) -> int:
        """Days past due (0 if not yet due or mastered)."""
        if self.due_on is None:
            return 0
        return max(0, (today - self.due_on).days)

    def is_due(self, today: date) -> bool:
        """Whether the problem should be revised today."""
        return self.due_on is not None and self.due_on <= today


def schedule_for(solved_on: date, revisions: Sequence[Revision]) -> Schedule:
    """Replay a problem's revisions to find when it is next due."""
    stage = 0
    anchor = solved_on
    for revision in sorted(revisions, key=lambda r: r.reviewed_on):
        anchor = revision.reviewed_on
        if revision.outcome == "solid":
            stage += 1
        elif revision.outcome == "forgot":
            stage = 0
        # "shaky" keeps the stage: the same interval, from today.
    if stage >= len(INTERVALS):
        return Schedule(stage=stage, due_on=None, mastered=True)
    return Schedule(
        stage=stage, due_on=anchor + timedelta(days=INTERVALS[stage]), mastered=False
    )


@dataclass(frozen=True)
class TopicStat:
    """How one topic is going, from the problem log alone."""

    topic: str
    problems: int
    needed_hint: int
    revisions: int
    forgotten: int
    mastered: int

    @property
    def struggle(self) -> float:
        """Share of attempts that went badly: hints plus forgotten revisions.

        0.0 = every problem solved unaided and every revision remembered.
        Reported, never scored — it only orders the topic list.
        """
        attempts = self.problems + self.revisions
        if attempts == 0:
            return 0.0
        return (self.needed_hint + self.forgotten) / attempts
