"""Exam countdown plan: a study target, and what's needed per day to reach it."""

from __future__ import annotations

from datetime import date, timedelta

from fastapi.testclient import TestClient

from routers.agenda import study_pace
from test_session_editor import YESTERDAY, add


def test_pace_rules() -> None:
    assert study_pace(None, 0, 5) is None  # no target
    assert study_pace(600, 0, 0) is None  # exam day: no study days left
    assert study_pace(600, 0, 5) == 120
    assert study_pace(600, 590, 4) == 5  # rounded up to 5, never 0 while short
    assert study_pace(600, 600, 4) == 0  # reached
    assert study_pace(600, 900, 4) == 0
    assert study_pace(100, 0, 3) == 35  # 33.3 → 35


def test_target_studied_and_pace(auth_client: TestClient) -> None:
    due = (date.today() + timedelta(days=4)).isoformat()
    exam = auth_client.post(
        "/api/agenda/deadlines",
        json={
            "title": "OS midterm",
            "kind": "exam",
            "due_date": due,
            "study_target_minutes": 600,
        },
    ).json()
    assert exam["study_target_minutes"] == 600
    assert exam["needed_per_day"] == 150  # 600 over 4 days

    add(auth_client, f"{YESTERDAY}T09:00", 120, deadline_id=exam["id"])
    listed = auth_client.get("/api/agenda/deadlines").json()[0]
    assert listed["studied_minutes"] == 120
    assert listed["needed_per_day"] == 120  # 480 over 4 days

    # Editing returns the real studied total, not 0.
    edited = auth_client.patch(
        f"/api/agenda/deadlines/{exam['id']}", json={"study_target_minutes": 300}
    ).json()
    assert edited["studied_minutes"] == 120
    assert edited["needed_per_day"] == 45  # 180 over 4 → 45

    cleared = auth_client.patch(
        f"/api/agenda/deadlines/{exam['id']}", json={"study_target_minutes": None}
    ).json()
    assert cleared["study_target_minutes"] is None
    assert cleared["needed_per_day"] is None
