"""The twelve upgrades, from focus blocks to the evening reminder.

Focus blocks, exam prep, plan pre-fill, target suggestions, year in review,
settings groups, weekly export and reminders.

Category ids: 1 SDE, 2 AI, 3 Maint, 4 DSA, 5 Exercise, 6 Coursework.
"""

from __future__ import annotations

import json
import os
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import config
import database
from models import Session as WorkSession

SDE, AI, MAINT, DSA, EXERCISE, COURSEWORK = 1, 2, 3, 4, 5, 6
TODAY = date.today()


def iso(days_ago: int) -> str:
    return (TODAY - timedelta(days=days_ago)).isoformat()


def backdate_running(minutes: int) -> None:
    """Pretend the running session started `minutes` ago (shifting its end too)."""
    db = database.SessionLocal()
    try:
        session = db.query(WorkSession).filter(WorkSession.ended_at.is_(None)).one()
        shift = timedelta(minutes=minutes)
        start = datetime.fromisoformat(session.started_at) - shift
        session.started_at = start.isoformat()
        if session.planned_end:
            end = datetime.fromisoformat(session.planned_end) - shift
            session.planned_end = end.isoformat()
        db.commit()
    finally:
        db.close()


# --- Focus blocks ------------------------------------------------------------


class TestFocus:
    def test_focus_block_has_a_planned_end(self, auth_client: TestClient) -> None:
        s = auth_client.post(
            "/api/sessions/start", json={"category_id": DSA, "planned_minutes": 25}
        ).json()
        started = datetime.fromisoformat(s["started_at"])
        assert datetime.fromisoformat(s["planned_end"]) - started == timedelta(minutes=25)

    def test_an_expired_block_records_exactly_the_plan(
        self, auth_client: TestClient
    ) -> None:
        auth_client.post(
            "/api/sessions/start", json={"category_id": DSA, "planned_minutes": 25}
        )
        backdate_running(180)  # left for three hours
        assert auth_client.get("/api/sessions/running").json() is None
        sessions = auth_client.get("/api/sessions").json()
        assert sessions[0]["minutes"] == 25
        assert sessions[0]["ended_at"] == sessions[0]["planned_end"]

    def test_stopping_early_records_real_time(self, auth_client: TestClient) -> None:
        auth_client.post(
            "/api/sessions/start", json={"category_id": DSA, "planned_minutes": 50}
        )
        backdate_running(20)
        stopped = auth_client.post("/api/sessions/stop").json()
        assert stopped["minutes"] == 20

    def test_open_ended_timer_is_unchanged(self, auth_client: TestClient) -> None:
        s = auth_client.post("/api/sessions/start", json={"category_id": DSA}).json()
        assert s["planned_end"] is None
        backdate_running(300)
        assert auth_client.get("/api/sessions/running").json() is not None

    def test_plan_is_bounded(self, auth_client: TestClient) -> None:
        r = auth_client.post(
            "/api/sessions/start", json={"category_id": DSA, "planned_minutes": 500}
        )
        assert r.status_code == 422


# --- Exam prep ---------------------------------------------------------------


def exam(client: TestClient, days_ahead: int = 5) -> dict:
    return client.post(
        "/api/agenda/deadlines",
        json={
            "title": "OS midterm",
            "kind": "exam",
            "due_date": (TODAY + timedelta(days=days_ahead)).isoformat(),
        },
    ).json()


class TestExamPrep:
    def test_linked_sessions_count_as_study(self, auth_client: TestClient) -> None:
        e = exam(auth_client)
        auth_client.post(
            "/api/sessions",
            json={"category_id": COURSEWORK, "log_date": iso(1), "minutes": 70},
        )
        s = auth_client.post(
            "/api/sessions/start",
            json={"category_id": COURSEWORK, "deadline_id": e["id"]},
        ).json()
        assert s["deadline_id"] == e["id"]
        backdate_running(45)
        auth_client.post("/api/sessions/stop")
        listed = auth_client.get("/api/agenda/deadlines").json()
        assert listed[0]["studied_minutes"] == 45  # the unlinked 70 does not count

    def test_linking_afterwards_and_unlinking(self, auth_client: TestClient) -> None:
        e = exam(auth_client)
        s = auth_client.post(
            "/api/sessions",
            json={"category_id": COURSEWORK, "log_date": iso(1), "minutes": 30},
        ).json()
        auth_client.patch(f"/api/sessions/{s['id']}", json={"deadline_id": e["id"]})
        assert auth_client.get("/api/agenda/deadlines").json()[0]["studied_minutes"] == 30
        auth_client.patch(f"/api/sessions/{s['id']}", json={"deadline_id": 0})
        assert auth_client.get("/api/agenda/deadlines").json()[0]["studied_minutes"] == 0

    def test_deleting_the_exam_keeps_the_minutes(self, auth_client: TestClient) -> None:
        e = exam(auth_client)
        s = auth_client.post(
            "/api/sessions",
            json={"category_id": COURSEWORK, "log_date": iso(1), "minutes": 30},
        ).json()
        auth_client.patch(f"/api/sessions/{s['id']}", json={"deadline_id": e["id"]})
        auth_client.delete(f"/api/agenda/deadlines/{e['id']}")
        kept = auth_client.get(f"/api/sessions?start={iso(1)}&end={iso(1)}").json()
        assert kept[0]["minutes"] == 30
        assert kept[0]["deadline_id"] is None

    def test_unknown_exam_is_404(self, auth_client: TestClient) -> None:
        r = auth_client.post(
            "/api/sessions/start", json={"category_id": COURSEWORK, "deadline_id": 99}
        )
        assert r.status_code == 404


# --- Plan pre-fill -----------------------------------------------------------


class TestPlanSuggest:
    def test_suggests_the_weeks_even_share(self, auth_client: TestClient) -> None:
        tomorrow = TODAY + timedelta(days=1)
        out = auth_client.get(f"/api/plan/{tomorrow.isoformat()}/suggest").json()
        by_id = {i["category_id"]: i for i in out["items"]}
        # Every suggestion is a multiple of 5; unscheduled days get 0.
        assert all(i["minutes"] % 5 == 0 for i in out["items"])
        exercise = by_id[EXERCISE]  # every day, 30 min
        assert exercise["minutes"] >= 0
        assert exercise["reason"]

    def test_an_exam_day_gets_its_override(self, auth_client: TestClient) -> None:
        # After tracking starts (2026-10-01 in tests), so every category counts.
        auth_client.post(
            "/api/agenda/deadlines",
            json={"title": "OS midterm", "kind": "exam", "due_date": "2026-10-14"},
        )
        out = auth_client.get("/api/plan/2026-10-14/suggest").json()
        assert all(i["minutes"] == 0 for i in out["items"])
        assert all(i["reason"] == "override for that day" for i in out["items"])

    def test_mentions_an_exam_coming_up(self, auth_client: TestClient) -> None:
        exam(auth_client, days_ahead=3)
        out = auth_client.get(
            f"/api/plan/{(TODAY + timedelta(days=1)).isoformat()}/suggest"
        ).json()
        assert out["upcoming_exams"] == ["OS midterm in 2d"]

    def test_saves_nothing(self, auth_client: TestClient) -> None:
        day = (TODAY + timedelta(days=1)).isoformat()
        auth_client.get(f"/api/plan/{day}/suggest")
        assert auth_client.get(f"/api/plan/{day}").json()["planned_total"] == 0


# --- Target suggestions ------------------------------------------------------


REF = date(2026, 11, 2)  # a Monday; the four weeks before it are all tracked


def log_weeks(client: TestClient, category: int, minutes: int, weeks: int) -> None:
    for w in range(1, weeks + 1):
        for d in range(7):
            day = REF - timedelta(days=7 * w) + timedelta(days=d)
            client.put(
                "/api/logs",
                json={
                    "log_date": day.isoformat(),
                    "category_id": category,
                    "minutes_logged": minutes,
                },
            )


def suggestions(client: TestClient) -> list[dict]:
    return client.get(
        f"/api/accountability/target-suggestions?today={REF.isoformat()}"
    ).json()


class TestTargetSuggestions:
    def test_consistently_over_suggests_a_raise(self, auth_client: TestClient) -> None:
        log_weeks(auth_client, EXERCISE, 45, weeks=4)  # 150% of 30
        ex = next(s for s in suggestions(auth_client) if s["category_id"] == EXERCISE)
        assert ex["direction"] == "raise"
        assert ex["current_target"] == 30
        assert ex["suggested_target"] == 45
        assert len(ex["weekly_percents"]) == 4
        assert ex["effective_from"] == "2026-11-09"

    def test_consistently_under_suggests_a_cut(self, auth_client: TestClient) -> None:
        log_weeks(auth_client, EXERCISE, 10, weeks=4)  # 33%
        ex = next(s for s in suggestions(auth_client) if s["category_id"] == EXERCISE)
        assert ex["direction"] == "lower"
        assert ex["suggested_target"] == 10

    def test_nothing_for_a_normal_month(self, auth_client: TestClient) -> None:
        log_weeks(auth_client, EXERCISE, 30, weeks=4)
        assert all(s["category_id"] != EXERCISE for s in suggestions(auth_client))

    def test_needs_every_week(self, auth_client: TestClient) -> None:
        log_weeks(auth_client, EXERCISE, 45, weeks=2)  # the two before are 0%
        assert all(s["category_id"] != EXERCISE for s in suggestions(auth_client))

    def test_thresholds_come_from_settings(self, auth_client: TestClient) -> None:
        log_weeks(auth_client, EXERCISE, 45, weeks=4)
        auth_client.put("/api/settings", json={"values": {"target_review_high": 200}})
        assert all(s["category_id"] != EXERCISE for s in suggestions(auth_client))

    def test_nothing_before_targets_exist(self, auth_client: TestClient) -> None:
        # The seeded targets start 2026-10-01; weeks before owe nothing.
        early = auth_client.get(
            "/api/accountability/target-suggestions?today=2026-10-12"
        ).json()
        assert early == []


# --- Year in review / letter exam prep ---------------------------------------


class TestYear:
    def test_year_sums_its_months(self, auth_client: TestClient) -> None:
        auth_client.put(
            "/api/logs",
            json={"log_date": iso(40), "category_id": SDE, "minutes_logged": 100},
        )
        year = (TODAY - timedelta(days=40)).year
        out = auth_client.get(f"/api/letter/year/{year}").json()
        assert out["total_minutes"] >= 100
        assert sum(m["minutes"] for m in out["months"]) == out["total_minutes"]
        assert out["best_month"] is not None

    def test_future_year_refused(self, auth_client: TestClient) -> None:
        assert auth_client.get(f"/api/letter/year/{TODAY.year + 1}").status_code == 422

    def test_letter_lists_exam_prep(self, auth_client: TestClient) -> None:
        e = exam(auth_client, days_ahead=0)
        s = auth_client.post(
            "/api/sessions",
            json={"category_id": COURSEWORK, "log_date": iso(0), "minutes": 55},
        ).json()
        auth_client.patch(f"/api/sessions/{s['id']}", json={"deadline_id": e["id"]})
        letter = auth_client.get(f"/api/letter/{TODAY:%Y-%m}").json()
        assert letter["exam_prep"] == [
            {"title": "OS midterm", "due_date": TODAY.isoformat(), "minutes": 55}
        ]


# --- Settings groups ---------------------------------------------------------


class TestSettings:
    def test_groups_are_reported(self, auth_client: TestClient) -> None:
        rows = {r["key"]: r for r in auth_client.get("/api/settings").json()}
        assert rows["par_window_days"]["group"] == "scoring"
        assert rows["target_review_high"]["group"] == "suggestions"
        assert rows["export_dir"]["group"] == "backup"

    def test_time_is_validated_and_normalised(self, auth_client: TestClient) -> None:
        ok = auth_client.put("/api/settings", json={"values": {"reminder_time": "8:05"}})
        rows = {r["key"]: r for r in ok.json()}
        assert rows["reminder_time"]["value"] == "08:05"
        bad = auth_client.put(
            "/api/settings", json={"values": {"reminder_time": "25:00"}}
        )
        assert bad.status_code == 422

    def test_folder_must_exist(self, auth_client: TestClient, tmp_path: Path) -> None:
        bad = auth_client.put(
            "/api/settings", json={"values": {"export_dir": str(tmp_path / "nope")}}
        )
        assert bad.status_code == 422
        ok = auth_client.put(
            "/api/settings", json={"values": {"export_dir": str(tmp_path)}}
        )
        assert ok.status_code == 200

    def test_reset_one_group_only(self, auth_client: TestClient, tmp_path: Path) -> None:
        auth_client.put(
            "/api/settings",
            json={"values": {"export_dir": str(tmp_path), "par_window_days": 14}},
        )
        rows = {
            r["key"]: r
            for r in auth_client.post("/api/settings/reset?group=scoring").json()
        }
        assert rows["par_window_days"]["value"] == "7"
        assert rows["export_dir"]["value"] == str(tmp_path.resolve())


# --- Weekly export -----------------------------------------------------------


class TestExport:
    def test_nothing_without_a_folder(self, auth_client: TestClient) -> None:
        r = auth_client.post("/api/settings/export-folder/now")
        assert r.status_code == 422

    def test_export_now_writes_the_full_export(
        self, auth_client: TestClient, tmp_path: Path
    ) -> None:
        auth_client.put("/api/settings", json={"values": {"export_dir": str(tmp_path)}})
        status = auth_client.post("/api/settings/export-folder/now").json()
        written = tmp_path / status["latest"]
        data = json.loads(written.read_text())
        assert set(data) >= {"categories", "daily_logs", "habits", "problems"}
        assert data == auth_client.get("/api/settings/export.json").json()

    def test_weekly_cadence_and_rotation(
        self, auth_client: TestClient, tmp_path: Path
    ) -> None:
        import exporter

        auth_client.put(
            "/api/settings",
            json={"values": {"export_dir": str(tmp_path), "export_keep": 2}},
        )
        db = database.SessionLocal()
        try:
            assert exporter.export_to_folder(db) is not None  # none yet: due
            assert exporter.export_to_folder(db) is None  # just written: not due
            # Age the newest past a week, then pretend two older ones exist.
            newest = sorted(tmp_path.glob("dayshift-export-*.json"))[-1]
            old = time.time() - 8 * 86400
            os.utime(newest, (old, old))
            for stamp in ("2020-01-01", "2020-01-08"):
                (tmp_path / f"dayshift-export-{stamp}.json").write_text("{}")
            exporter.export_to_folder(db)
        finally:
            db.close()
        assert len(list(tmp_path.glob("dayshift-export-*.json"))) == 2


# --- Evening reminder --------------------------------------------------------


@pytest.fixture
def reminder():
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
    import reminder as module

    return module


class TestReminder:
    def test_lists_what_is_open(self, auth_client: TestClient, reminder) -> None:
        auth_client.post(
            "/api/goals/habits",
            json={"name": "Read", "active_days": "MON,TUE,WED,THU,FRI,SAT,SUN"},
        )
        items = reminder.open_items(TODAY)
        assert "check-in not done" in items
        assert "1 habit unticked" in items
        assert "tomorrow not planned" in items

    def test_quiet_when_all_done(self, auth_client: TestClient, reminder) -> None:
        auth_client.put(
            "/api/checkins", json={"check_date": TODAY.isoformat(), "mood": 3}
        )
        auth_client.post(
            f"/api/plan/{(TODAY + timedelta(days=1)).isoformat()}/tasks",
            json={"text": "x"},
        )
        assert reminder.open_items(TODAY) == []

    def test_off_by_default_sends_nothing(
        self, auth_client: TestClient, reminder, monkeypatch, tmp_path: Path
    ) -> None:
        sent: list[str] = []
        monkeypatch.setattr(reminder, "notify", sent.append)
        monkeypatch.setattr(reminder, "STATE_FILE", tmp_path / "sent")
        reminder.main([])
        assert sent == []

    def test_sends_once_a_day_after_the_time(
        self, auth_client: TestClient, reminder, monkeypatch, tmp_path: Path
    ) -> None:
        auth_client.put(
            "/api/settings",
            json={"values": {"reminder_enabled": True, "reminder_time": "00:00"}},
        )
        sent: list[str] = []
        monkeypatch.setattr(reminder, "notify", sent.append)
        monkeypatch.setattr(reminder, "STATE_FILE", tmp_path / "sent")
        reminder.main([])
        reminder.main([])
        assert len(sent) == 1
        assert sent[0].startswith("Check-in not done")


def test_backups_dir_is_the_test_one(auth_client: TestClient, tmp_path: Path) -> None:
    # Guard: the client fixture must keep snapshots out of the real folder.
    assert config.BACKUPS_DIR.parent == tmp_path
