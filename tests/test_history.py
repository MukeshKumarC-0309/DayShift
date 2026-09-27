"""Session history: every delete/edit/split/merge is kept and undoable.

Deletions and minute edits made after the day reach the honesty ledger (the
user's choices).

Category ids: 1 SDE, 2 AI, 3 Maint, 4 DSA, 5 Exercise, 6 Coursework.
"""

from __future__ import annotations

from datetime import date, timedelta

from fastapi.testclient import TestClient

from test_session_editor import YESTERDAY, add, timed_at

SDE, AI = 1, 2
TODAY = date.today().isoformat()


def changes(client: TestClient, **params: object) -> list[dict]:
    return client.get("/api/sessions/changes", params=params).json()


def undo(client: TestClient, change: dict):
    return client.post(f"/api/sessions/changes/{change['id']}/undo")


def day_sessions(client: TestClient, day: str, category: int = SDE) -> list[dict]:
    detail = client.get(f"/api/stats/day/{day}").json()
    return next(c for c in detail["categories"] if c["category_id"] == category)[
        "sessions"
    ]


class TestDeleteAndRestore:
    def test_a_deleted_session_stops_counting_and_can_be_restored(
        self, auth_client: TestClient
    ) -> None:
        exam = auth_client.post(
            "/api/agenda/deadlines",
            json={
                "title": "OS midterm",
                "kind": "exam",
                "due_date": (date.today() + timedelta(days=5)).isoformat(),
            },
        ).json()
        session = timed_at(
            auth_client,
            f"{YESTERDAY}T09:00",
            45,
            note="paging",
            tags=["os"],
            git_ref="#3",
        )
        auth_client.patch(
            f"/api/sessions/{session['id']}", json={"deadline_id": exam["id"]}
        )
        auth_client.delete(f"/api/sessions/{session['id']}")
        assert day_sessions(auth_client, YESTERDAY) == []
        assert auth_client.get("/api/agenda/deadlines").json()[0]["studied_minutes"] == 0

        latest = changes(auth_client)[0]
        assert latest["action"] == "delete"
        assert latest["minutes_before"] == 45 and latest["minutes_after"] == 0
        restored = undo(auth_client, latest).json()
        assert restored[0]["id"] == session["id"]  # same id back
        assert restored[0]["source"] == "timer"  # still measured
        assert restored[0]["tags"] == ["os"]
        assert restored[0]["git_ref"] == "#3"
        assert restored[0]["deadline_id"] == exam["id"]
        assert auth_client.get("/api/agenda/deadlines").json()[0]["studied_minutes"] == 45

    def test_undo_only_once(self, auth_client: TestClient) -> None:
        session = add(auth_client, f"{YESTERDAY}T09:00", 30).json()
        auth_client.delete(f"/api/sessions/{session['id']}")
        change = changes(auth_client)[0]
        assert undo(auth_client, change).status_code == 200
        again = undo(auth_client, change)
        assert again.status_code == 409
        assert "already been undone" in again.json()["detail"]

    def test_restoring_never_overlaps_what_was_added_since(
        self, auth_client: TestClient
    ) -> None:
        session = add(auth_client, f"{YESTERDAY}T09:00", 60).json()
        auth_client.delete(f"/api/sessions/{session['id']}")
        change = changes(auth_client)[0]
        add(auth_client, f"{YESTERDAY}T09:30", 30)
        refused = undo(auth_client, change)
        assert refused.status_code == 409
        assert "overlap" in refused.json()["detail"]
        assert len(day_sessions(auth_client, YESTERDAY)) == 1  # nothing changed

    def test_a_running_session_is_discarded_not_deleted(
        self, auth_client: TestClient
    ) -> None:
        auth_client.post("/api/sessions/start", json={"category_id": SDE})
        running = auth_client.get("/api/sessions/running").json()
        assert auth_client.delete(f"/api/sessions/{running['id']}").status_code == 409


class TestUndoEditsSplitsMerges:
    def test_undo_an_edit(self, auth_client: TestClient) -> None:
        session = timed_at(auth_client, f"{YESTERDAY}T09:00", 95)
        auth_client.patch(f"/api/sessions/{session['id']}", json={"minutes": 60})
        restored = undo(auth_client, changes(auth_client)[0]).json()[0]
        assert restored["minutes"] == 95
        assert restored["source"] == "timer"
        assert restored["measured_minutes"] is None

    def test_an_edit_that_changes_nothing_is_not_recorded(
        self, auth_client: TestClient
    ) -> None:
        session = add(auth_client, f"{YESTERDAY}T09:00", 30, note="x").json()
        auth_client.patch(f"/api/sessions/{session['id']}", json={"note": "x"})
        assert changes(auth_client) == []

    def test_undo_a_split(self, auth_client: TestClient) -> None:
        session = timed_at(auth_client, f"{YESTERDAY}T09:00", 60)
        auth_client.post(f"/api/sessions/{session['id']}/split", json={"at_minute": 20})
        undo(auth_client, changes(auth_client)[0])
        rows = day_sessions(auth_client, YESTERDAY)
        assert [(r["id"], r["minutes"]) for r in rows] == [(session["id"], 60)]

    def test_undo_a_merge_brings_back_the_parts(self, auth_client: TestClient) -> None:
        a = timed_at(auth_client, f"{YESTERDAY}T09:00", 40, note="a", tags=["x"])
        b = timed_at(auth_client, f"{YESTERDAY}T10:00", 30, note="b", tags=["y"])
        auth_client.post("/api/sessions/merge", json={"session_ids": [a["id"], b["id"]]})
        undo(auth_client, changes(auth_client)[0])
        rows = day_sessions(auth_client, YESTERDAY)
        assert [(r["id"], r["minutes"], r["note"], r["tags"]) for r in rows] == [
            (a["id"], 40, "a", ["x"]),
            (b["id"], 30, "b", ["y"]),
        ]

    def test_a_later_change_blocks_undoing_an_earlier_one(
        self, auth_client: TestClient
    ) -> None:
        session = timed_at(auth_client, f"{YESTERDAY}T09:00", 60)
        halves = auth_client.post(
            f"/api/sessions/{session['id']}/split", json={"at_minute": 20}
        ).json()
        split = changes(auth_client)[0]
        auth_client.patch(f"/api/sessions/{halves[1]['id']}", json={"note": "later"})
        refused = undo(auth_client, split)
        assert refused.status_code == 409
        assert "changed since" in refused.json()["detail"]
        # Undo the later edit first, then the split goes through.
        undo(auth_client, changes(auth_client)[0])
        assert undo(auth_client, split).status_code == 200


class TestLedger:
    def test_lists_deletions_and_minute_edits_made_after_the_day(
        self, auth_client: TestClient
    ) -> None:
        deleted = add(auth_client, f"{YESTERDAY}T08:00", 30).json()
        shortened = add(auth_client, f"{YESTERDAY}T09:00", 60).json()
        renamed = add(auth_client, f"{YESTERDAY}T11:00", 20).json()
        split = add(auth_client, f"{YESTERDAY}T13:00", 40).json()
        auth_client.delete(f"/api/sessions/{deleted['id']}")
        auth_client.patch(f"/api/sessions/{shortened['id']}", json={"minutes": 30})
        auth_client.patch(f"/api/sessions/{renamed['id']}", json={"note": "renamed"})
        auth_client.post(f"/api/sessions/{split['id']}/split", json={"at_minute": 10})

        listed = changes(auth_client, after_the_fact=True)
        assert [
            (c["action"], c["minutes_before"], c["minutes_after"]) for c in listed
        ] == [
            ("edit", 60, 30),
            ("delete", 30, 0),
        ]
        assert all(c["after_the_fact"] for c in listed)
        assert len(changes(auth_client)) == 4  # all four are undoable

    def test_same_day_changes_are_not_after_the_fact(
        self, auth_client: TestClient
    ) -> None:
        session = timed_at(auth_client, f"{TODAY}T00:30", 10)
        auth_client.delete(f"/api/sessions/{session['id']}")
        assert changes(auth_client, after_the_fact=True) == []
        assert changes(auth_client)[0]["after_the_fact"] is False


def test_split_halves_do_not_overlap(auth_client: TestClient) -> None:
    # Regression: the first half kept the original end time, so the halves'
    # clock ranges overlapped (09:00-10:00 and 09:20-10:00).
    session = add(auth_client, f"{YESTERDAY}T09:00", 60).json()
    first, second = auth_client.post(
        f"/api/sessions/{session['id']}/split", json={"at_minute": 20}
    ).json()
    assert (first["started_at"], first["ended_at"]) == (
        f"{YESTERDAY}T09:00:00",
        f"{YESTERDAY}T09:20:00",
    )
    assert (second["started_at"], second["ended_at"]) == (
        f"{YESTERDAY}T09:20:00",
        f"{YESTERDAY}T10:00:00",
    )
