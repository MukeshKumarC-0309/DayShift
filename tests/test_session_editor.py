"""Sessions after the fact: editing (what stays "measured"), search, tag rollups.

An edited timer session becomes `manual` (the user's choice) and keeps the
timer's own reading in `measured_minutes`. Everything else about a session —
note, tags, category, exam — can change without touching that status.

Category ids: 1 SDE, 2 AI, 3 Maint, 4 DSA, 5 Exercise, 6 Coursework.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

from fastapi.testclient import TestClient

import database
from models import Session as WorkSession

SDE, AI = 1, 2


def timed_session(client: TestClient, minutes: int, **start: object) -> dict:
    """Record a finished timer session of `minutes` via the real start/stop routes."""
    client.post("/api/sessions/start", json={"category_id": SDE, **start})
    db = database.SessionLocal()
    try:
        running = db.query(WorkSession).filter(WorkSession.ended_at.is_(None)).one()
        started = datetime.fromisoformat(running.started_at) - timedelta(minutes=minutes)
        running.started_at = started.isoformat()
        db.commit()
    finally:
        db.close()
    return client.post("/api/sessions/stop").json()


class TestEditingMinutes:
    def test_editing_timer_minutes_makes_it_manual_and_keeps_the_reading(
        self, auth_client: TestClient
    ) -> None:
        session = timed_session(auth_client, 95)
        assert session["source"] == "timer"

        edited = auth_client.patch(f"/api/sessions/{session['id']}", json={"minutes": 60})
        body = edited.json()
        assert body["minutes"] == 60
        assert body["source"] == "manual"
        assert body["measured_minutes"] == 95

    def test_a_second_edit_keeps_the_original_reading(
        self, auth_client: TestClient
    ) -> None:
        session = timed_session(auth_client, 95)
        auth_client.patch(f"/api/sessions/{session['id']}", json={"minutes": 60})
        again = auth_client.patch(f"/api/sessions/{session['id']}", json={"minutes": 45})
        assert again.json()["measured_minutes"] == 95

    def test_saving_the_same_minutes_is_not_an_edit(
        self, auth_client: TestClient
    ) -> None:
        # The editor sends every field; an unchanged number must not relabel.
        session = timed_session(auth_client, 40)
        body = auth_client.patch(
            f"/api/sessions/{session['id']}", json={"minutes": 40, "note": "x"}
        ).json()
        assert body["source"] == "timer"
        assert body["measured_minutes"] is None

    def test_note_tags_and_category_leave_it_measured(
        self, auth_client: TestClient
    ) -> None:
        session = timed_session(auth_client, 30)
        body = auth_client.patch(
            f"/api/sessions/{session['id']}",
            json={"note": "auth refactor", "tags": ["Auth", "tests"], "category_id": AI},
        ).json()
        assert body["source"] == "timer"
        assert body["tags"] == ["auth", "tests"]
        assert body["category_id"] == AI

    def test_a_hand_added_session_has_no_reading(self, auth_client: TestClient) -> None:
        created = auth_client.post(
            "/api/sessions",
            json={
                "category_id": SDE,
                "log_date": date.today().isoformat(),
                "minutes": 20,
            },
        ).json()
        body = auth_client.patch(
            f"/api/sessions/{created['id']}", json={"minutes": 25}
        ).json()
        assert body["source"] == "manual"
        assert body["measured_minutes"] is None

    def test_edited_minutes_are_what_counts(self, auth_client: TestClient) -> None:
        session = timed_session(auth_client, 90)
        auth_client.patch(f"/api/sessions/{session['id']}", json={"minutes": 50})
        day = auth_client.get(f"/api/stats/day/{session['log_date']}").json()
        sde = next(c for c in day["categories"] if c["category_id"] == SDE)
        assert sde["timed_minutes"] == 50


class TestTags:
    def test_tags_can_be_set_when_starting(self, auth_client: TestClient) -> None:
        session = timed_session(auth_client, 10, tags=["Revision", " dp "])
        assert session["tags"] == ["dp", "revision"]

    def test_tags_can_be_cleared(self, auth_client: TestClient) -> None:
        session = timed_session(auth_client, 10, tags=["dp"])
        body = auth_client.patch(
            f"/api/sessions/{session['id']}", json={"tags": []}
        ).json()
        assert body["tags"] == []

    def test_overlong_tags_are_rejected(self, auth_client: TestClient) -> None:
        session = timed_session(auth_client, 10)
        too_long = auth_client.patch(
            f"/api/sessions/{session['id']}", json={"tags": ["x" * 49]}
        )
        too_many = auth_client.patch(
            f"/api/sessions/{session['id']}", json={"tags": [f"t{i}" for i in range(13)]}
        )
        assert too_long.status_code == 422
        assert too_many.status_code == 422

    def test_tag_list_counts_use(self, auth_client: TestClient) -> None:
        timed_session(auth_client, 10, tags=["dp"])
        timed_session(auth_client, 20, tags=["dp", "graphs"])
        tags = {t["name"]: t for t in auth_client.get("/api/sessions/tags/all").json()}
        assert tags["dp"]["session_count"] == 2
        assert tags["dp"]["total_minutes"] == 30


class TestSplit:
    def test_split_keeps_the_exam_on_both_halves(self, auth_client: TestClient) -> None:
        exam = auth_client.post(
            "/api/agenda/deadlines",
            json={
                "title": "OS midterm",
                "kind": "exam",
                "due_date": (date.today() + timedelta(days=5)).isoformat(),
            },
        ).json()
        session = timed_session(auth_client, 60, deadline_id=exam["id"])
        halves = auth_client.post(
            f"/api/sessions/{session['id']}/split", json={"at_minute": 20}
        ).json()
        assert [h["deadline_id"] for h in halves] == [exam["id"], exam["id"]]
        listed = auth_client.get("/api/agenda/deadlines").json()
        assert listed[0]["studied_minutes"] == 60

    def test_splitting_a_timer_session_keeps_it_measured(
        self, auth_client: TestClient
    ) -> None:
        # Splitting divides a measurement; it doesn't change the total.
        session = timed_session(auth_client, 60)
        halves = auth_client.post(
            f"/api/sessions/{session['id']}/split", json={"at_minute": 25}
        ).json()
        assert [h["source"] for h in halves] == ["timer", "timer"]
        assert [h["minutes"] for h in halves] == [25, 35]


def on_day(client: TestClient, session: dict, day: date) -> None:
    """Move a finished session to another date (the rollup filters by date)."""
    client.patch(f"/api/sessions/{session['id']}", json={"log_date": day.isoformat()})


class TestSearch:
    def test_finds_by_note_and_by_tag(self, auth_client: TestClient) -> None:
        timed_session(auth_client, 10, note="Token bucket limiter", tags=["backend"])
        timed_session(auth_client, 10, note="Graphs", tags=["bfs"])
        by_note = auth_client.get("/api/sessions/search", params={"q": "bucket"}).json()
        by_tag = auth_client.get("/api/sessions/search", params={"q": "BF"}).json()
        assert [h["session"]["note"] for h in by_note] == ["Token bucket limiter"]
        assert [h["session"]["note"] for h in by_tag] == ["Graphs"]
        assert by_tag[0]["category_name"] == "SDE Project"

    def test_wildcards_match_literally(self, auth_client: TestClient) -> None:
        # "%" used to be passed to LIKE as a wildcard and matched everything.
        timed_session(auth_client, 10, note="coverage to 100%")
        timed_session(auth_client, 10, note="unrelated")
        percent = auth_client.get("/api/sessions/search", params={"q": "100%"}).json()
        underscore = auth_client.get("/api/sessions/search", params={"q": "_"}).json()
        assert [h["session"]["note"] for h in percent] == ["coverage to 100%"]
        assert underscore == []

    def test_exact_tag_filter(self, auth_client: TestClient) -> None:
        timed_session(auth_client, 10, note="a", tags=["dp"])
        timed_session(auth_client, 10, note="b", tags=["dp-hard"])
        exact = auth_client.get("/api/sessions/search", params={"tag": "DP"}).json()
        assert [h["session"]["note"] for h in exact] == ["a"]

    def test_text_and_tag_together(self, auth_client: TestClient) -> None:
        timed_session(auth_client, 10, note="knapsack", tags=["dp"])
        timed_session(auth_client, 10, note="knapsack", tags=["greedy"])
        hits = auth_client.get(
            "/api/sessions/search", params={"q": "knap", "tag": "greedy"}
        ).json()
        assert [h["session"]["tags"] for h in hits] == [["greedy"]]

    def test_nothing_to_search_for_is_rejected(self, auth_client: TestClient) -> None:
        assert (
            auth_client.get("/api/sessions/search", params={"q": "  "}).status_code == 422
        )


class TestTagRollup:
    def test_period_totals_overlap_and_untagged(self, auth_client: TestClient) -> None:
        today = date.today()
        timed_session(auth_client, 30, tags=["dp", "arrays"])
        timed_session(auth_client, 20, tags=["dp"])
        timed_session(auth_client, 15)
        old = timed_session(auth_client, 40, tags=["dp"])
        on_day(auth_client, old, today - timedelta(days=40))

        body = auth_client.get(
            "/api/sessions/tags/rollup",
            params={
                "start": (today - timedelta(days=6)).isoformat(),
                "end": today.isoformat(),
            },
        ).json()
        rows = {r["name"]: r for r in body["tags"]}
        assert body["total_minutes"] == 65
        assert body["untagged_minutes"] == 15
        assert rows["dp"]["total_minutes"] == 50
        assert rows["dp"]["session_count"] == 2
        # A session with two tags counts toward both.
        assert rows["arrays"]["total_minutes"] == 30
        assert [r["name"] for r in body["tags"]] == ["dp", "arrays"]

    def test_split_by_category(self, auth_client: TestClient) -> None:
        a = timed_session(auth_client, 30, tags=["reading"])
        timed_session(auth_client, 10, tags=["reading"])
        auth_client.patch(f"/api/sessions/{a['id']}", json={"category_id": AI})
        today = date.today().isoformat()
        body = auth_client.get(
            "/api/sessions/tags/rollup", params={"start": today, "end": today}
        ).json()
        assert body["tags"][0]["by_category"] == {str(AI): 30, str(SDE): 10}

    def test_backwards_period_is_rejected(self, auth_client: TestClient) -> None:
        response = auth_client.get(
            "/api/sessions/tags/rollup",
            params={"start": "2026-10-10", "end": "2026-10-01"},
        )
        assert response.status_code == 422


def add(client: TestClient, start: str, minutes: int, **extra: object):
    """Add a hand-entered session starting at `start` (ISO, local time)."""
    return client.post(
        "/api/sessions",
        json={
            "category_id": SDE,
            "log_date": start[:10],
            "minutes": minutes,
            "started_at": start,
            **extra,
        },
    )


YESTERDAY = (date.today() - timedelta(days=1)).isoformat()


class TestAddingPastSession:
    def test_adds_a_manual_session_with_its_exam(self, auth_client: TestClient) -> None:
        exam = auth_client.post(
            "/api/agenda/deadlines",
            json={
                "title": "OS midterm",
                "kind": "exam",
                "due_date": (date.today() + timedelta(days=5)).isoformat(),
            },
        ).json()
        response = add(
            auth_client, f"{YESTERDAY}T09:30", 50, tags=["os"], deadline_id=exam["id"]
        )
        body = response.json()
        assert response.status_code == 201
        assert body["source"] == "manual"
        assert body["started_at"] == f"{YESTERDAY}T09:30:00"
        assert body["ended_at"] == f"{YESTERDAY}T10:20:00"
        assert body["deadline_id"] == exam["id"]
        listed = auth_client.get("/api/agenda/deadlines").json()
        assert listed[0]["studied_minutes"] == 50

    def test_an_overlap_is_refused_and_named(self, auth_client: TestClient) -> None:
        assert add(auth_client, f"{YESTERDAY}T09:00", 60).status_code == 201
        clash = add(auth_client, f"{YESTERDAY}T09:45", 30)
        assert clash.status_code == 409
        assert "09:00-10:00, SDE Project" in clash.json()["detail"]

    def test_a_block_inside_another_is_an_overlap(self, auth_client: TestClient) -> None:
        add(auth_client, f"{YESTERDAY}T09:00", 120)
        assert add(auth_client, f"{YESTERDAY}T09:30", 15).status_code == 409

    def test_touching_ends_are_fine(self, auth_client: TestClient) -> None:
        add(auth_client, f"{YESTERDAY}T09:00", 60)
        assert add(auth_client, f"{YESTERDAY}T10:00", 30).status_code == 201
        assert add(auth_client, f"{YESTERDAY}T08:30", 30).status_code == 201

    def test_overlapping_a_timed_session_is_refused(
        self, auth_client: TestClient
    ) -> None:
        # Across categories too: you can't do two things at once.
        timed = timed_session(auth_client, 40)
        start = datetime.fromisoformat(timed["started_at"]) + timedelta(minutes=10)
        response = auth_client.post(
            "/api/sessions",
            json={
                "category_id": AI,
                "log_date": start.date().isoformat(),
                "minutes": 5,
                "started_at": start.isoformat(),
            },
        )
        assert response.status_code == 409

    def test_the_running_timer_counts_up_to_now(self, auth_client: TestClient) -> None:
        auth_client.post("/api/sessions/start", json={"category_id": AI})
        db = database.SessionLocal()
        try:
            running = db.query(WorkSession).filter(WorkSession.ended_at.is_(None)).one()
            started = datetime.fromisoformat(running.started_at) - timedelta(minutes=60)
            running.started_at = started.isoformat()
            db.commit()
        finally:
            db.close()
        inside = datetime.now().replace(microsecond=0) - timedelta(minutes=30)
        response = auth_client.post(
            "/api/sessions",
            json={
                "category_id": SDE,
                "log_date": inside.date().isoformat(),
                "minutes": 10,
                "started_at": inside.isoformat(),
            },
        )
        assert response.status_code == 409

    def test_a_block_that_has_not_ended_is_refused(self, auth_client: TestClient) -> None:
        soon = datetime.now().replace(second=0, microsecond=0) + timedelta(minutes=5)
        response = auth_client.post(
            "/api/sessions",
            json={
                "category_id": SDE,
                "log_date": soon.date().isoformat(),
                "minutes": 30,
                "started_at": soon.isoformat(),
            },
        )
        assert response.status_code == 422
        assert "hasn't finished" in response.json()["detail"]

    def test_the_start_must_be_on_the_date(self, auth_client: TestClient) -> None:
        response = auth_client.post(
            "/api/sessions",
            json={
                "category_id": SDE,
                "log_date": YESTERDAY,
                "minutes": 30,
                "started_at": f"{(date.today() - timedelta(days=2)).isoformat()}T09:00",
            },
        )
        assert response.status_code == 422

    def test_exact_midnight_is_refused(self, auth_client: TestClient) -> None:
        # 00:00:00 is the "no time of day" marker; a real start there would vanish.
        response = add(auth_client, f"{YESTERDAY}T00:00", 30)
        assert response.status_code == 422
        assert "00:01" in response.json()["detail"]

    def test_sessions_without_a_time_never_overlap(self, auth_client: TestClient) -> None:
        untimed = auth_client.post(
            "/api/sessions",
            json={"category_id": SDE, "log_date": YESTERDAY, "minutes": 120},
        )
        assert untimed.status_code == 201
        assert add(auth_client, f"{YESTERDAY}T00:30", 60).status_code == 201


class TestGitRef:
    def test_set_when_starting_and_kept_on_split(self, auth_client: TestClient) -> None:
        session = timed_session(auth_client, 60, git_ref="  feature/rate-limiter ")
        assert session["git_ref"] == "feature/rate-limiter"
        halves = auth_client.post(
            f"/api/sessions/{session['id']}/split", json={"at_minute": 20}
        ).json()
        assert [h["git_ref"] for h in halves] == ["feature/rate-limiter"] * 2

    def test_edited_and_cleared(self, auth_client: TestClient) -> None:
        session = timed_session(auth_client, 30)
        url = f"/api/sessions/{session['id']}"
        assert auth_client.patch(url, json={"git_ref": "#42"}).json()["git_ref"] == "#42"
        # Changing only the reference leaves the session measured.
        assert auth_client.patch(url, json={"git_ref": "#43"}).json()["source"] == "timer"
        assert auth_client.patch(url, json={"git_ref": "  "}).json()["git_ref"] is None

    def test_on_a_hand_added_session(self, auth_client: TestClient) -> None:
        body = add(auth_client, f"{YESTERDAY}T09:00", 30, git_ref="fix/login-bug").json()
        assert body["git_ref"] == "fix/login-bug"

    def test_search_finds_it(self, auth_client: TestClient) -> None:
        timed_session(auth_client, 10, note="limiter", git_ref="feature/rate-limiter")
        timed_session(auth_client, 10, note="other")
        hits = auth_client.get("/api/sessions/search", params={"q": "RATE-lim"}).json()
        assert [h["session"]["git_ref"] for h in hits] == ["feature/rate-limiter"]

    def test_one_line_and_bounded(self, auth_client: TestClient) -> None:
        session = timed_session(auth_client, 10)
        url = f"/api/sessions/{session['id']}"
        assert auth_client.patch(url, json={"git_ref": "a\nb"}).status_code == 422
        assert auth_client.patch(url, json={"git_ref": "x" * 121}).status_code == 422

    def test_in_the_export(self, auth_client: TestClient) -> None:
        timed_session(auth_client, 10, git_ref="#7")
        export = auth_client.get("/api/settings/export.json").json()
        assert export["sessions"][0]["git_ref"] == "#7"


def timed_at(client: TestClient, start: str, minutes: int, **extra: object) -> dict:
    """Record a finished timer session, then move it to `start` in the database."""
    session = timed_session(client, minutes, **extra)
    begin = datetime.fromisoformat(start)
    db = database.SessionLocal()
    try:
        row = db.get(WorkSession, session["id"])
        assert row is not None
        row.started_at = begin.isoformat()
        row.ended_at = (begin + timedelta(minutes=minutes)).isoformat()
        row.log_date = begin.date().isoformat()
        db.commit()
    finally:
        db.close()
    return session


def merge(client: TestClient, *sessions: dict):
    return client.post(
        "/api/sessions/merge", json={"session_ids": [s["id"] for s in sessions]}
    )


class TestMerge:
    def test_two_timer_sessions_become_one_measured_session(
        self, auth_client: TestClient
    ) -> None:
        a = timed_at(auth_client, f"{YESTERDAY}T09:00", 40, note="auth", tags=["backend"])
        b = timed_at(
            auth_client,
            f"{YESTERDAY}T10:00",
            30,
            note="auth",
            tags=["tests"],
            git_ref="#4",
        )
        response = merge(auth_client, b, a)  # order doesn't matter
        body = response.json()
        assert response.status_code == 200
        assert body["id"] == a["id"]  # the earliest part is kept
        assert body["minutes"] == 70  # the sum, not the 09:00-10:30 span
        assert body["started_at"] == f"{YESTERDAY}T09:00:00"
        assert body["ended_at"] == f"{YESTERDAY}T10:30:00"
        assert body["source"] == "timer"
        assert body["note"] == "auth"  # identical notes aren't repeated
        assert body["tags"] == ["backend", "tests"]
        assert body["git_ref"] == "#4"
        day = auth_client.get(f"/api/stats/day/{YESTERDAY}").json()
        sde = next(c for c in day["categories"] if c["category_id"] == SDE)
        assert [s["id"] for s in sde["sessions"]] == [a["id"]]
        assert sde["timed_minutes"] == 70

    def test_mixing_in_a_manual_session_makes_it_manual(
        self, auth_client: TestClient
    ) -> None:
        a = timed_at(auth_client, f"{YESTERDAY}T09:00", 40)
        b = add(auth_client, f"{YESTERDAY}T10:00", 20, note="notes").json()
        body = merge(auth_client, a, b).json()
        assert body["source"] == "manual"
        # One part was never measured, so there is no measured total to keep.
        assert body["measured_minutes"] is None

    def test_edited_timer_parts_keep_their_readings(
        self, auth_client: TestClient
    ) -> None:
        # Regression: the kept part's minutes were overwritten with the total
        # before the measured total was summed, counting it twice.
        a = timed_at(auth_client, f"{YESTERDAY}T09:00", 40)
        b = timed_at(auth_client, f"{YESTERDAY}T10:00", 50)
        auth_client.patch(f"/api/sessions/{b['id']}", json={"minutes": 30})
        body = merge(auth_client, a, b).json()
        assert body["minutes"] == 70
        assert body["source"] == "manual"
        assert body["measured_minutes"] == 90  # 40 measured + 50 measured

    def test_a_gap_is_fine_when_nothing_is_in_it(self, auth_client: TestClient) -> None:
        a = add(auth_client, f"{YESTERDAY}T09:00", 60).json()
        b = add(auth_client, f"{YESTERDAY}T11:00", 60).json()
        body = merge(auth_client, a, b).json()
        assert body["minutes"] == 120
        assert body["ended_at"] == f"{YESTERDAY}T12:00:00"

    def test_something_in_between_blocks_it(self, auth_client: TestClient) -> None:
        a = add(auth_client, f"{YESTERDAY}T09:00", 60).json()
        b = add(auth_client, f"{YESTERDAY}T11:00", 60).json()
        auth_client.post(
            "/api/sessions",
            json={
                "category_id": AI,
                "log_date": YESTERDAY,
                "minutes": 30,
                "started_at": f"{YESTERDAY}T10:15",
            },
        )
        response = merge(auth_client, a, b)
        assert response.status_code == 409
        assert "10:15-10:45, AI Automation" in response.json()["detail"]

    def test_different_exams_are_refused(self, auth_client: TestClient) -> None:
        exam = auth_client.post(
            "/api/agenda/deadlines",
            json={
                "title": "OS midterm",
                "kind": "exam",
                "due_date": (date.today() + timedelta(days=5)).isoformat(),
            },
        ).json()
        a = add(auth_client, f"{YESTERDAY}T09:00", 60, deadline_id=exam["id"]).json()
        b = add(auth_client, f"{YESTERDAY}T10:00", 60).json()
        response = merge(auth_client, a, b)
        assert response.status_code == 409
        assert "different exams" in response.json()["detail"]
        # Same exam on both: fine, and the exam's hours are unchanged.
        auth_client.patch(f"/api/sessions/{b['id']}", json={"deadline_id": exam["id"]})
        assert merge(auth_client, a, b).status_code == 200
        assert (
            auth_client.get("/api/agenda/deadlines").json()[0]["studied_minutes"] == 120
        )

    def test_other_category_or_day_is_refused(self, auth_client: TestClient) -> None:
        a = add(auth_client, f"{YESTERDAY}T09:00", 30).json()
        other_cat = auth_client.post(
            "/api/sessions",
            json={
                "category_id": AI,
                "log_date": YESTERDAY,
                "minutes": 30,
                "started_at": f"{YESTERDAY}T10:00",
            },
        ).json()
        earlier = (date.today() - timedelta(days=2)).isoformat()
        other_day = add(auth_client, f"{earlier}T09:00", 30).json()
        assert merge(auth_client, a, other_cat).status_code == 422
        assert merge(auth_client, a, other_day).status_code == 422

    def test_running_untimed_or_single_is_refused(self, auth_client: TestClient) -> None:
        a = add(auth_client, f"{YESTERDAY}T09:00", 30).json()
        untimed = auth_client.post(
            "/api/sessions",
            json={"category_id": SDE, "log_date": YESTERDAY, "minutes": 30},
        ).json()
        assert merge(auth_client, a, untimed).status_code == 422
        assert merge(auth_client, a, a).status_code == 422
        auth_client.post("/api/sessions/start", json={"category_id": SDE})
        running = auth_client.get("/api/sessions/running").json()
        assert merge(auth_client, a, running).status_code in (409, 422)


def test_rollup_includes_branches(auth_client: TestClient) -> None:
    add(auth_client, f"{YESTERDAY}T09:00", 40, git_ref="feature/auth")
    add(auth_client, f"{YESTERDAY}T10:00", 20, git_ref="feature/auth")
    add(auth_client, f"{YESTERDAY}T11:00", 15, git_ref="#42")
    add(auth_client, f"{YESTERDAY}T12:00", 30)
    body = auth_client.get(
        "/api/sessions/tags/rollup", params={"start": YESTERDAY, "end": YESTERDAY}
    ).json()
    assert [
        (b["name"], b["total_minutes"], b["session_count"]) for b in body["branches"]
    ] == [
        ("feature/auth", 60, 2),
        ("#42", 15, 1),
    ]
