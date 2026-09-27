"""A small, dependency-free reader for iCalendar (.ics) files.

Only what the agenda import needs: each event's start date, title and UID.
Handles line folding, escaped text, all-day dates, floating and UTC
date-times, and TZID date-times (read as the wall-clock date written, which is
right for the single-timezone use this app assumes). Recurrence rules are not
expanded — a weekly lecture series is not an exam.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, date, datetime

EXAM_WORDS = re.compile(
    r"\b(exams?|mid[- ]?terms?|mid[- ]?sem|end[- ]?sem|finals?|quiz|tests?|viva)\b",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Event:
    """One calendar event, reduced to what an agenda item needs."""

    uid: str | None
    title: str
    day: date
    recurring: bool

    @property
    def looks_like_exam(self) -> bool:
        """A guess from the title, used only to pre-select the kind."""
        return bool(EXAM_WORDS.search(self.title))


def _unfold(text: str) -> list[str]:
    """Join folded lines (a line starting with space or tab continues)."""
    lines: list[str] = []
    for raw in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if raw[:1] in (" ", "\t") and lines:
            lines[-1] += raw[1:]
        else:
            lines.append(raw)
    return lines


def _unescape(value: str) -> str:
    return (
        value.replace("\\n", " ")
        .replace("\\N", " ")
        .replace("\\,", ",")
        .replace("\\;", ";")
        .replace("\\\\", "\\")
        .strip()
    )


def _parse_date(params: str, value: str) -> date | None:
    value = value.strip()
    try:
        if "VALUE=DATE" in params.upper() or re.fullmatch(r"\d{8}", value):
            return datetime.strptime(value[:8], "%Y%m%d").date()
        if value.endswith("Z"):
            moment = datetime.strptime(value, "%Y%m%dT%H%M%SZ").replace(tzinfo=UTC)
            return moment.astimezone().date()  # to this machine's local date
        return datetime.strptime(value[:15], "%Y%m%dT%H%M%S").date()
    except ValueError:
        return None


def parse(text: str) -> list[Event]:
    """Every VEVENT with a readable start date and a title."""
    events: list[Event] = []
    current: dict[str, tuple[str, str]] | None = None
    for line in _unfold(text):
        if line == "BEGIN:VEVENT":
            current = {}
            continue
        if line == "END:VEVENT":
            if current is not None and "DTSTART" in current and "SUMMARY" in current:
                day = _parse_date(*current["DTSTART"])
                title = _unescape(current["SUMMARY"][1])
                if day is not None and title:
                    events.append(
                        Event(
                            uid=current.get("UID", ("", ""))[1].strip() or None,
                            title=title[:200],
                            day=day,
                            recurring="RRULE" in current,
                        )
                    )
            current = None
            continue
        if current is None or ":" not in line:
            continue
        head, value = line.split(":", 1)
        name, _, params = head.partition(";")
        name = name.upper()
        if name not in current:  # first occurrence wins
            current[name] = (params, value)
    return events
