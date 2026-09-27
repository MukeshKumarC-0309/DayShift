"""Quick-add: `POST /api/logs/adjust` adds a delta to one day's typed numbers.

The dashboard's `+15`, `+30` and `+1 Q` buttons (and their undo) go through
this, so it must add rather than overwrite, and refuse to go below zero.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

SDE, DSA = 1, 4
DAY = "2026-10-05"


def adjust(client: TestClient, category: int, minutes: int = 0, questions: int = 0):
    return client.post(
        "/api/logs/adjust",
        json={
            "log_date": DAY,
            "category_id": category,
            "minutes_delta": minutes,
            "questions_delta": questions,
        },
    )


def test_creates_the_row_when_the_day_has_none(auth_client: TestClient) -> None:
    row = adjust(auth_client, SDE, minutes=15).json()
    assert row["minutes_logged"] == 15
    assert row["log_date"] == DAY


def test_adds_to_what_was_typed(auth_client: TestClient) -> None:
    auth_client.put(
        "/api/logs", json={"log_date": DAY, "category_id": SDE, "minutes_logged": 60}
    )
    row = adjust(auth_client, SDE, minutes=30).json()
    assert row["minutes_logged"] == 90


def test_undo_takes_back_exactly_what_was_added(auth_client: TestClient) -> None:
    adjust(auth_client, SDE, minutes=45)
    adjust(auth_client, SDE, minutes=15)
    row = adjust(auth_client, SDE, minutes=-15).json()
    assert row["minutes_logged"] == 45


def test_questions_add_independently(auth_client: TestClient) -> None:
    adjust(auth_client, DSA, minutes=20)
    row = adjust(auth_client, DSA, questions=1).json()
    assert row["questions_solved"] == 1
    assert row["minutes_logged"] == 20


def test_never_goes_below_zero(auth_client: TestClient) -> None:
    adjust(auth_client, SDE, minutes=10)
    response = adjust(auth_client, SDE, minutes=-15)
    assert response.status_code == 422
    # Refused, not clamped: the stored value is untouched.
    rows = auth_client.get(f"/api/logs/day/{DAY}").json()
    assert rows[0]["minutes_logged"] == 10


def test_never_exceeds_a_day(auth_client: TestClient) -> None:
    auth_client.put(
        "/api/logs", json={"log_date": DAY, "category_id": SDE, "minutes_logged": 1430}
    )
    assert adjust(auth_client, SDE, minutes=15).status_code == 422


def test_keeps_an_existing_override(auth_client: TestClient) -> None:
    auth_client.put(
        "/api/logs",
        json={"log_date": DAY, "category_id": SDE, "override_target_minutes": 90},
    )
    row = adjust(auth_client, SDE, minutes=30).json()
    assert row["override_target_minutes"] == 90


def test_quick_add_counts_in_the_gauge(auth_client: TestClient) -> None:
    adjust(auth_client, SDE, minutes=30)
    adjust(auth_client, SDE, minutes=30)
    progress = auth_client.get(f"/api/stats/dashboard?today={DAY}").json()["progress"]
    sde = next(p for p in progress if p["category_id"] == SDE)
    assert sde["manual_minutes"] == 60


def test_unknown_category_is_404(auth_client: TestClient) -> None:
    assert adjust(auth_client, 999, minutes=5).status_code == 404


def test_requires_sign_in(client: TestClient) -> None:
    assert adjust(client, SDE, minutes=5).status_code == 401
