"""The evening reminder: one Mac notification listing what is still open today.

Run every 15 minutes by launchd (see `make reminder-install`). It does
nothing unless Settings → Backups & reminders has the reminder switched on,
the chosen time has passed, and no reminder went out today. It only READS the
database, and says nothing when nothing is open.

    .venv/bin/python scripts/reminder.py            # normal run
    .venv/bin/python scripts/reminder.py --now      # ignore time/once-a-day
    .venv/bin/python scripts/reminder.py --dry-run  # print, don't notify

Everything is local: `osascript` shows the notification. No network.
"""

from __future__ import annotations

import subprocess
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from sqlalchemy import select  # noqa: E402
from sqlalchemy.orm import selectinload  # noqa: E402

import config  # noqa: E402
import database  # noqa: E402
import habit_rules  # noqa: E402
import practice  # noqa: E402
import settings_store  # noqa: E402
from models import CheckIn, Habit, PlanMinutes, PlanTask, Problem  # noqa: E402

STATE_FILE = config.DATA_DIR / ".reminder-sent"


def open_items(today: date) -> list[str]:
    """List what is still open today, in the order worth reading."""
    db = database.SessionLocal()
    try:
        items: list[str] = []
        if (
            db.scalar(select(CheckIn).where(CheckIn.check_date == today.isoformat()))
            is None
        ):
            items.append("check-in not done")

        unticked = []
        for habit in db.scalars(
            select(Habit)
            .options(selectinload(Habit.checks))
            .where(Habit.archived_at.is_(None))
        ):
            rule = habit_rules.HabitRule.of(habit.start_date, habit.active_days)
            ticked = any(c.check_date == today.isoformat() for c in habit.checks)
            if rule.applies(today) and not ticked:
                unticked.append(habit.name)
        if unticked:
            items.append(
                f"{len(unticked)} habit{'s' if len(unticked) > 1 else ''} unticked"
            )

        due = 0
        for problem in db.scalars(select(Problem).options(selectinload(Problem.reviews))):
            schedule = practice.schedule_for(
                date.fromisoformat(problem.solved_on),
                [
                    practice.Revision(date.fromisoformat(r.reviewed_on), r.outcome)
                    for r in problem.reviews
                ],
            )
            due += schedule.is_due(today)
        if due:
            items.append(f"{due} DSA revision{'s' if due > 1 else ''} due")

        open_tasks = len(
            db.scalars(
                select(PlanTask.id).where(
                    PlanTask.plan_date == today.isoformat(), PlanTask.done.is_(False)
                )
            ).all()
        )
        if open_tasks:
            items.append(f"{open_tasks} planned task{'s' if open_tasks > 1 else ''} left")

        tomorrow = (today + timedelta(days=1)).isoformat()
        planned = db.scalar(select(PlanMinutes).where(PlanMinutes.plan_date == tomorrow))
        has_tasks = db.scalar(select(PlanTask).where(PlanTask.plan_date == tomorrow))
        if planned is None and has_tasks is None:
            items.append("tomorrow not planned")
        return items
    finally:
        db.close()


def notify(message: str) -> None:
    """Show a macOS notification. Text is passed as data, never as script."""
    script = (
        "on run argv\n"
        "display notification (item 1 of argv) "
        'with title "Dayshift" sound name "default"\n'
        "end run"
    )
    subprocess.run(["osascript", "-e", script, message], check=False)


def main(argv: list[str]) -> int:
    """Send today's reminder if it is due."""
    now = datetime.now()
    force, dry = "--now" in argv, "--dry-run" in argv
    db = database.SessionLocal()
    try:
        values = settings_store.load_all(db)
    finally:
        db.close()
    if not force:
        if not values["reminder_enabled"]:
            return 0
        hours, minutes = (int(x) for x in values["reminder_time"].split(":"))
        if (now.hour, now.minute) < (hours, minutes):
            return 0
        if (
            STATE_FILE.exists()
            and STATE_FILE.read_text().strip() == now.date().isoformat()
        ):
            return 0

    items = open_items(now.date())
    if dry:
        print("; ".join(items) or "nothing open — no notification")
        return 0
    if items:
        notify(" · ".join(items).capitalize())
    STATE_FILE.write_text(now.date().isoformat())
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
