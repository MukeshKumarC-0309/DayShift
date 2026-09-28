"""Time the heaviest endpoints against a large synthetic history.

    make bench            # ~2 years of logs, ~9k timer sessions

Builds a throwaway database in a temp directory (never your real data), fills
it with six categories of daily logs and several sessions a day since
2024-09-01, then times each endpoint once warm. Use it to decide whether a
performance change is needed — measured on 2026-09-24, the slowest endpoint
(a year of insights) took under 90 ms at 9k sessions, so none was.
"""

from __future__ import annotations

import os
import random
import shutil
import sqlite3
import sys
import tempfile
import time
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> None:
    """Build the synthetic history and print each endpoint's warm time."""
    tmp = Path(tempfile.mkdtemp(prefix="dayshift-bench-"))
    os.environ.update(
        DATA_DIR=str(tmp),
        JWT_SECRET="benchmark-secret-long-enough-for-validation",
        TRACKING_START_DATE="2024-09-01",
        LOG_LEVEL="WARNING",
    )
    sys.path.insert(0, str(ROOT / "backend"))
    try:
        _run(tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _run(tmp: Path) -> None:
    from fastapi.testclient import TestClient

    import app as app_module

    with TestClient(app_module.app) as client:
        client.post(
            "/api/auth/setup", json={"username": "bench", "passcode": "bench-pass"}
        )
        db = sqlite3.connect(tmp / "dayshift.db")
        random.seed(1)
        start, today = date(2024, 9, 1), date.today()
        sessions = 0
        day = start
        while day < today:
            for category in range(1, 7):
                db.execute(
                    "INSERT INTO daily_logs (log_date, category_id, minutes_logged, "
                    "questions_solved, created_at, updated_at) VALUES (?,?,?,?,?,?)",
                    (
                        day.isoformat(),
                        category,
                        random.randint(0, 120),
                        random.randint(0, 2) if category == 4 else 0,
                        "x",
                        "x",
                    ),
                )
                for k in range(random.choice([1, 2, 2, 3])):
                    hour = 8 + 3 * k
                    db.execute(
                        "INSERT INTO sessions (category_id, log_date, started_at, "
                        "ended_at, minutes, source, created_at, updated_at) "
                        "VALUES (?,?,?,?,?,?,?,?)",
                        (
                            category,
                            day.isoformat(),
                            f"{day}T{hour:02d}:00:00",
                            f"{day}T{hour + 1:02d}:00:00",
                            60,
                            "timer",
                            "x",
                            "x",
                        ),
                    )
                    sessions += 1
            day += timedelta(days=1)
        db.commit()
        db.close()  # an open file can't be deleted on Windows
        print(f"{(today - start).days} days, {sessions} sessions\n")

        urls = [
            "/api/stats/dashboard",
            "/api/accountability/pace",
            "/api/agenda/today",
            "/api/stats/insights?days=365&average_window=7",
            "/api/accountability/records",
            "/api/accountability/review",
            f"/api/letter/{today:%Y-%m}",
            "/api/checkins/insights?days=365",
            f"/api/stats/calendar?start={today - timedelta(days=364)}&end={today}",
        ]
        for url in urls:
            client.get(url)  # warm
            began = time.perf_counter()
            response = client.get(url)
            elapsed = (time.perf_counter() - began) * 1000
            print(f"{elapsed:8.1f} ms  {response.status_code}  {url}")


if __name__ == "__main__":
    main()
