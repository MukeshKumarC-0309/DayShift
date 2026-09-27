"""Focus-block stats: finished vs ended early, per planned length."""

from __future__ import annotations

from datetime import date, datetime, timedelta

from fastapi.testclient import TestClient

import database
from models import Session as WorkSession
from routers.focus import Block, summarise

SDE = 1


def block(client: TestClient, planned: int, ran: int, days_ago: int = 1) -> None:
    """Record a finished focus block planned for `planned` min that ran `ran`."""
    client.post(
        "/api/sessions/start", json={"category_id": SDE, "planned_minutes": planned}
    )
    db = database.SessionLocal()
    try:
        s = db.query(WorkSession).filter(WorkSession.ended_at.is_(None)).one()
        start = datetime.combine(
            date.today() - timedelta(days=days_ago), datetime.min.time()
        ).replace(hour=9)
        s.started_at = start.isoformat()
        s.planned_end = (start + timedelta(minutes=planned)).isoformat()
        s.ended_at = (start + timedelta(minutes=min(ran, planned))).isoformat()
        s.minutes = min(ran, planned)
        s.log_date = start.date().isoformat()
        db.commit()
    finally:
        db.close()


def test_summary_counts() -> None:
    blocks = [
        Block(planned=25, minutes=25, finished=True),
        Block(planned=25, minutes=10, finished=False),
        Block(planned=50, minutes=50, finished=True),
        Block(planned=50, minutes=20, finished=False),
    ]
    out = summarise(blocks, date(2026, 9, 1), date(2026, 9, 30))
    assert (out.blocks, out.finished, out.ended_early) == (4, 2, 2)
    assert out.focus_minutes == 105
    assert out.average_early_minutes == 15
    assert [(b.planned_minutes, b.blocks, b.finished) for b in out.by_length] == [
        (25, 2, 1),
        (50, 2, 1),
    ]


def test_endpoint(auth_client: TestClient) -> None:
    block(auth_client, 25, 25)
    block(auth_client, 25, 12, days_ago=2)
    block(auth_client, 50, 50, days_ago=40)  # outside a 30-day window
    body = auth_client.get("/api/stats/focus", params={"days": 30}).json()
    assert (body["blocks"], body["finished"], body["ended_early"]) == (2, 1, 1)
    assert body["average_early_minutes"] == 12


def test_open_sessions_and_merges_are_not_blocks(auth_client: TestClient) -> None:
    auth_client.post("/api/sessions/start", json={"category_id": SDE})
    auth_client.post("/api/sessions/stop")
    body = auth_client.get("/api/stats/focus").json()
    assert body["blocks"] == 0
    assert body["average_early_minutes"] is None
