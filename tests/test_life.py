"""Life tracking: DSA problem log + revision, check-ins, deadlines and exams.

October 2026: Thu 1, Fri 2, Sat 3, Sun 4, Mon 5, Tue 6, Wed 7, Thu 8.
Tracking starts 2026-10-01 (conftest). Category ids: 1 SDE, 2 AI, 3 Maint,
4 DSA, 5 Exercise, 6 Coursework.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from practice import Revision, schedule_for

SDE, AI, MAINT, DSA, EXERCISE, COURSEWORK = 1, 2, 3, 4, 5, 6
SOLVED = date(2026, 10, 5)
MIDTERM = "Exam: OS midterm"


def problem(client: TestClient, **overrides: object) -> dict:
    body: dict[str, object] = {
        "title": "Two Sum",
        "topic": "Arrays",
        "difficulty": "easy",
        "solved_on": "2026-10-05",
    }
    body.update(overrides)
    response = client.post("/api/practice/problems", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def questions(client: TestClient, day: str, category: int = DSA) -> int:
    rows = client.get(f"/api/logs/day/{day}").json()
    row = next((r for r in rows if r["category_id"] == category), None)
    return row["questions_solved"] if row else 0


Override = tuple[int | None, str | None]


def override(client: TestClient, day: str, category: int) -> Override:
    rows = client.get(f"/api/logs/day/{day}").json()
    row = next((r for r in rows if r["category_id"] == category), None)
    if row is None:
        return None, None
    return row["override_target_minutes"], row["override_reason"]


# --- Revision schedule (pure) ------------------------------------------------


class TestSchedule:
    def test_first_revision_is_three_days_after_solving(self) -> None:
        s = schedule_for(SOLVED, [])
        assert s.due_on == date(2026, 10, 8)
        assert s.stage == 0

    def test_solid_advances_to_ten_then_thirty(self) -> None:
        one = schedule_for(SOLVED, [Revision(date(2026, 10, 8), "solid")])
        assert one.due_on == date(2026, 10, 18)
        two = schedule_for(
            SOLVED,
            [Revision(date(2026, 10, 8), "solid"), Revision(date(2026, 10, 18), "solid")],
        )
        assert two.due_on == date(2026, 11, 17)

    def test_three_solid_revisions_master_it(self) -> None:
        s = schedule_for(
            SOLVED,
            [
                Revision(date(2026, 10, 8), "solid"),
                Revision(date(2026, 10, 18), "solid"),
                Revision(date(2026, 11, 17), "solid"),
            ],
        )
        assert s.mastered is True
        assert s.due_on is None
        assert s.is_due(date(2027, 1, 1)) is False

    def test_shaky_repeats_the_same_interval(self) -> None:
        s = schedule_for(
            SOLVED,
            [Revision(date(2026, 10, 8), "solid"), Revision(date(2026, 10, 20), "shaky")],
        )
        assert s.stage == 1
        assert s.due_on == date(2026, 10, 30)  # 10 days from the shaky revision

    def test_forgot_starts_again(self) -> None:
        s = schedule_for(
            SOLVED,
            [
                Revision(date(2026, 10, 8), "solid"),
                Revision(date(2026, 10, 18), "forgot"),
            ],
        )
        assert s.stage == 0
        assert s.due_on == date(2026, 10, 21)

    def test_late_revision_re_anchors(self) -> None:
        # Revised 5 days late: the next interval counts from the revision.
        s = schedule_for(SOLVED, [Revision(date(2026, 10, 13), "solid")])
        assert s.due_on == date(2026, 10, 23)

    def test_overdue_days(self) -> None:
        s = schedule_for(SOLVED, [])
        assert s.overdue_days(date(2026, 10, 10)) == 2
        assert s.overdue_days(date(2026, 10, 7)) == 0


# --- Problem log over HTTP ---------------------------------------------------


class TestProblemLog:
    def test_logging_a_problem_counts_a_question(self, auth_client: TestClient) -> None:
        created = problem(auth_client)
        assert created["category_id"] == DSA
        assert questions(auth_client, "2026-10-05") == 1

    def test_counts_add_to_existing_questions(self, auth_client: TestClient) -> None:
        auth_client.put(
            "/api/logs",
            json={"log_date": "2026-10-05", "category_id": DSA, "questions_solved": 1},
        )
        problem(auth_client)
        assert questions(auth_client, "2026-10-05") == 2

    def test_a_logged_problem_scores_like_plus_one_q(
        self, auth_client: TestClient
    ) -> None:
        problem(auth_client)
        problem(auth_client, title="Valid Anagram")
        progress = auth_client.get("/api/stats/dashboard?today=2026-10-05").json()
        dsa = next(p for p in progress["progress"] if p["category_id"] == DSA)
        assert dsa["percent"] == 100.0  # two questions finish the day

    def test_deleting_takes_the_question_back(self, auth_client: TestClient) -> None:
        created = problem(auth_client)
        auth_client.delete(f"/api/practice/problems/{created['id']}")
        assert questions(auth_client, "2026-10-05") == 0

    def test_delete_never_goes_below_zero(self, auth_client: TestClient) -> None:
        created = problem(auth_client)
        # Count edited down by hand in the meantime.
        auth_client.put(
            "/api/logs",
            json={"log_date": "2026-10-05", "category_id": DSA, "questions_solved": 0},
        )
        auth_client.delete(f"/api/practice/problems/{created['id']}")
        assert questions(auth_client, "2026-10-05") == 0

    def test_moving_the_date_moves_the_question(self, auth_client: TestClient) -> None:
        created = problem(auth_client)
        auth_client.patch(
            f"/api/practice/problems/{created['id']}", json={"solved_on": "2026-10-06"}
        )
        assert questions(auth_client, "2026-10-05") == 0
        assert questions(auth_client, "2026-10-06") == 1

    def test_cannot_move_the_date_past_a_revision(self, auth_client: TestClient) -> None:
        created = problem(auth_client)  # solved 2026-10-05
        auth_client.post(
            f"/api/practice/problems/{created['id']}/reviews",
            json={"outcome": "solid", "reviewed_on": "2026-10-08"},
        )
        url = f"/api/practice/problems/{created['id']}"
        refused = auth_client.patch(url, json={"solved_on": "2026-10-09"})
        assert refused.status_code == 422
        assert "revised on 2026-10-08" in refused.json()["detail"]
        assert questions(auth_client, "2026-10-05") == 1  # nothing moved
        # Up to the revision's own day is fine.
        assert auth_client.patch(url, json={"solved_on": "2026-10-08"}).status_code == 200

    def test_removing_a_revision_resets_its_step(self, auth_client: TestClient) -> None:
        created = problem(auth_client)
        url = f"/api/practice/problems/{created['id']}"
        revised = auth_client.post(
            f"{url}/reviews", json={"outcome": "solid", "reviewed_on": "2026-10-08"}
        ).json()
        assert revised["stage"] == 1
        review_id = revised["reviews"][0]["id"]
        back = auth_client.delete(f"{url}/reviews/{review_id}").json()
        assert back["reviews"] == []
        assert back["stage"] == 0
        assert back["due_on"] == created["due_on"]
        # Removing a revision never touches the question count.
        assert questions(auth_client, "2026-10-05") == 1

    def test_revisions_never_count_as_questions(self, auth_client: TestClient) -> None:
        created = problem(auth_client)
        auth_client.post(
            f"/api/practice/problems/{created['id']}/reviews",
            json={"outcome": "solid", "reviewed_on": "2026-10-08"},
        )
        assert questions(auth_client, "2026-10-08") == 0
        assert questions(auth_client, "2026-10-05") == 1

    def test_revision_moves_the_schedule(self, auth_client: TestClient) -> None:
        created = problem(auth_client)
        assert created["due_on"] == "2026-10-08"
        after = auth_client.post(
            f"/api/practice/problems/{created['id']}/reviews",
            json={"outcome": "solid", "reviewed_on": "2026-10-08"},
        ).json()
        assert after["stage"] == 1
        assert after["due_on"] == "2026-10-18"

    def test_revision_before_solving_is_refused(self, auth_client: TestClient) -> None:
        created = problem(auth_client)
        response = auth_client.post(
            f"/api/practice/problems/{created['id']}/reviews",
            json={"outcome": "solid", "reviewed_on": "2026-10-01"},
        )
        assert response.status_code == 422

    def test_deleting_a_revision_restores_the_schedule(
        self, auth_client: TestClient
    ) -> None:
        created = problem(auth_client)
        after = auth_client.post(
            f"/api/practice/problems/{created['id']}/reviews",
            json={"outcome": "forgot", "reviewed_on": "2026-10-08"},
        ).json()
        review_id = after["reviews"][0]["id"]
        restored = auth_client.delete(
            f"/api/practice/problems/{created['id']}/reviews/{review_id}"
        ).json()
        assert restored["due_on"] == "2026-10-08"

    def test_summary_lists_due_problems_and_weak_topics(
        self, auth_client: TestClient
    ) -> None:
        problem(auth_client, title="A", topic="Graphs", needed_hint=True)
        problem(auth_client, title="B", topic="Arrays")
        summary = auth_client.get("/api/practice/summary?today=2026-10-09").json()
        assert {p["title"] for p in summary["due_today"]} == {"A", "B"}
        assert summary["topics"][0]["topic"] == "Graphs"  # weakest first
        assert summary["total_problems"] == 2

    def test_bad_difficulty_is_rejected(self, auth_client: TestClient) -> None:
        response = auth_client.post(
            "/api/practice/problems",
            json={
                "title": "X",
                "topic": "Y",
                "difficulty": "brutal",
                "solved_on": "2026-10-05",
            },
        )
        assert response.status_code == 422


# --- Check-ins ---------------------------------------------------------------


class TestCheckIns:
    def test_set_and_replace(self, auth_client: TestClient) -> None:
        body = {"check_date": "2026-10-05", "sleep_minutes": 420, "energy": 4, "mood": 3}
        assert auth_client.put("/api/checkins", json=body).status_code == 200
        body["energy"] = 2
        auth_client.put("/api/checkins", json=body)
        rows = auth_client.get("/api/checkins?start=2026-10-01&end=2026-10-31").json()
        assert len(rows) == 1
        assert rows[0]["energy"] == 2

    @pytest.mark.parametrize(
        "field,value", [("energy", 0), ("energy", 6), ("mood", 9), ("sleep_minutes", -1)]
    )
    def test_out_of_range_is_rejected(
        self, auth_client: TestClient, field: str, value: int
    ) -> None:
        body = {"check_date": "2026-10-05", field: value}
        assert auth_client.put("/api/checkins", json=body).status_code == 422

    def test_missing_days_are_gaps(self, auth_client: TestClient) -> None:
        auth_client.put(
            "/api/checkins", json={"check_date": "2026-10-05", "sleep_minutes": 400}
        )
        data = auth_client.get("/api/checkins/insights?days=7&today=2026-10-07").json()
        assert len(data["days"]) == 7
        assert data["gaps"] == 6
        gap = next(d for d in data["days"] if d["day"] == "2026-10-06")
        assert gap["checkin"] is None

    def test_short_sleep_lines_up_with_the_day(self, auth_client: TestClient) -> None:
        # Oct 5 (Mon): short sleep, nothing done. Oct 6 (Tue): long sleep, all done.
        auth_client.put(
            "/api/checkins", json={"check_date": "2026-10-05", "sleep_minutes": 300}
        )
        auth_client.put(
            "/api/checkins", json={"check_date": "2026-10-06", "sleep_minutes": 500}
        )
        for category, minutes in [
            (SDE, 180),
            (AI, 60),
            (DSA, 120),
            (EXERCISE, 30),
            (COURSEWORK, 60),
        ]:
            auth_client.put(
                "/api/logs",
                json={
                    "log_date": "2026-10-06",
                    "category_id": category,
                    "minutes_logged": minutes,
                },
            )
        data = auth_client.get("/api/checkins/insights?days=7&today=2026-10-07").json()
        by = {b["label"]: b for b in data["by_sleep"]}
        assert by["Under 6h"]["completion"] == 0.0
        assert by["8h or more"]["completion"] == 1.0
        assert by["7-8h"]["days"] == 0

    def test_completion_caps_each_category(self, auth_client: TestClient) -> None:
        # 600 min of SDE cannot hide a skipped AI Automation.
        auth_client.put(
            "/api/logs",
            json={"log_date": "2026-10-05", "category_id": SDE, "minutes_logged": 600},
        )
        data = auth_client.get("/api/checkins/insights?days=7&today=2026-10-07").json()
        monday = next(d for d in data["days"] if d["day"] == "2026-10-05")
        # Owed: SDE 180, AI 60, DSA 120, Exercise 30, Coursework 60 = 450.
        assert monday["completion"] == pytest.approx(180 / 450, abs=0.001)

    def test_today_is_listed_but_not_scored(self, auth_client: TestClient) -> None:
        data = auth_client.get("/api/checkins/insights?days=7&today=2026-10-07").json()
        assert data["days"][-1]["day"] == "2026-10-07"
        assert data["days"][-1]["completion"] is None

    def test_delete_makes_a_gap(self, auth_client: TestClient) -> None:
        auth_client.put("/api/checkins", json={"check_date": "2026-10-05", "mood": 4})
        assert auth_client.delete("/api/checkins/2026-10-05").status_code == 204
        assert auth_client.delete("/api/checkins/2026-10-05").status_code == 404


# --- Deadlines and exams -----------------------------------------------------


def exam(client: TestClient, **overrides: object) -> dict:
    body: dict[str, object] = {
        "title": "OS midterm",
        "kind": "exam",
        "due_date": "2026-10-14",
    }
    body.update(overrides)
    response = client.post("/api/agenda/deadlines", json=body)
    assert response.status_code == 201, response.text
    return response.json()


class TestExams:
    def test_exam_sets_zero_for_every_category_by_default(
        self, auth_client: TestClient
    ) -> None:
        created = exam(auth_client)
        assert len(created["overrides"]) == 6
        for category in (SDE, AI, MAINT, DSA, EXERCISE, COURSEWORK):
            assert override(auth_client, "2026-10-14", category) == (0, MIDTERM)

    def test_custom_targets_are_used(self, auth_client: TestClient) -> None:
        exam(
            auth_client,
            overrides=[
                {"category_id": SDE, "target_minutes": 0},
                {"category_id": COURSEWORK, "target_minutes": 90},
            ],
        )
        assert override(auth_client, "2026-10-14", COURSEWORK)[0] == 90
        assert override(auth_client, "2026-10-14", DSA) == (None, None)

    def test_exam_day_no_longer_counts_against_par(self, auth_client: TestClient) -> None:
        exam(auth_client, due_date="2026-10-05")
        par = auth_client.get("/api/stats/par?today=2026-10-06").json()
        sde = next(p for p in par if p["category_id"] == SDE)
        # Window Oct 1-5: SDE owed Fri 2, Sat 3, Sun 4 = 540; Oct 5 is 0 (exam).
        assert sde["target_total"] == 540

    def test_assignment_sets_no_override(self, auth_client: TestClient) -> None:
        created = exam(auth_client, kind="assignment", title="DBMS lab")
        assert created["overrides"] == []
        assert override(auth_client, "2026-10-14", SDE) == (None, None)

    def test_moving_an_exam_moves_its_overrides(self, auth_client: TestClient) -> None:
        created = exam(auth_client)
        auth_client.patch(
            f"/api/agenda/deadlines/{created['id']}", json={"due_date": "2026-10-16"}
        )
        assert override(auth_client, "2026-10-14", SDE) == (None, None)
        assert override(auth_client, "2026-10-16", SDE) == (0, "Exam: OS midterm")

    def test_renaming_updates_the_reason(self, auth_client: TestClient) -> None:
        created = exam(auth_client)
        auth_client.patch(
            f"/api/agenda/deadlines/{created['id']}", json={"title": "OS final"}
        )
        assert override(auth_client, "2026-10-14", SDE) == (0, "Exam: OS final")

    def test_deleting_takes_the_overrides_back(self, auth_client: TestClient) -> None:
        created = exam(auth_client)
        auth_client.delete(f"/api/agenda/deadlines/{created['id']}")
        assert override(auth_client, "2026-10-14", SDE) == (None, None)

    def test_a_hand_edit_survives_deleting_the_exam(
        self, auth_client: TestClient
    ) -> None:
        created = exam(auth_client)
        auth_client.put(
            "/api/logs",
            json={
                "log_date": "2026-10-14",
                "category_id": SDE,
                "override_target_minutes": 60,
            },
        )
        auth_client.delete(f"/api/agenda/deadlines/{created['id']}")
        assert override(auth_client, "2026-10-14", SDE)[0] == 60
        assert override(auth_client, "2026-10-14", AI) == (None, None)

    def test_changing_to_assignment_takes_overrides_back(
        self, auth_client: TestClient
    ) -> None:
        created = exam(auth_client)
        auth_client.patch(
            f"/api/agenda/deadlines/{created['id']}", json={"kind": "assignment"}
        )
        assert override(auth_client, "2026-10-14", SDE) == (None, None)

    def test_marking_done_keeps_the_override(self, auth_client: TestClient) -> None:
        created = exam(auth_client)
        done = auth_client.patch(
            f"/api/agenda/deadlines/{created['id']}", json={"done": True}
        ).json()
        assert done["done"] is True
        assert override(auth_client, "2026-10-14", SDE)[0] == 0
        listed = auth_client.get("/api/agenda/deadlines").json()
        assert listed == []

    def test_an_exam_added_after_the_day_reaches_the_ledger(
        self, auth_client: TestClient
    ) -> None:
        # The ledger compares when the override was SET (real clock) with the
        # day it governs, so the exam must lie before the real today.
        past = (date.today() - timedelta(days=3)).isoformat()
        exam(auth_client, due_date=past)
        ledger = auth_client.get("/api/accountability/ledger").json()
        assert {e["log_date"] for e in ledger["entries"]} == {past}
        assert all(e["override_reason"] == "Exam: OS midterm" for e in ledger["entries"])

    def test_an_exam_added_in_advance_stays_out_of_the_ledger(
        self, auth_client: TestClient
    ) -> None:
        future = (date.today() + timedelta(days=5)).isoformat()
        exam(auth_client, due_date=future)
        ledger = auth_client.get("/api/accountability/ledger").json()
        assert ledger["entries"] == []

    def test_unknown_category_is_404(self, auth_client: TestClient) -> None:
        response = auth_client.post(
            "/api/agenda/deadlines",
            json={
                "title": "X",
                "kind": "exam",
                "due_date": "2026-10-14",
                "overrides": [{"category_id": 99, "target_minutes": 0}],
            },
        )
        assert response.status_code == 404


class TestToday:
    def test_today_line(self, auth_client: TestClient) -> None:
        problem(auth_client)  # due Oct 8
        exam(auth_client, due_date="2026-10-12")
        exam(auth_client, kind="assignment", title="Far away", due_date="2026-12-01")
        auth_client.put("/api/checkins", json={"check_date": "2026-10-09", "energy": 3})
        today = auth_client.get("/api/agenda/today?today=2026-10-09").json()
        assert today["revisions_due"] == 1
        assert [d["title"] for d in today["deadlines"]] == ["OS midterm"]
        assert today["deadlines"][0]["days_left"] == 3
        assert today["checkin"]["energy"] == 3

    def test_no_checkin_is_null(self, auth_client: TestClient) -> None:
        today = auth_client.get("/api/agenda/today?today=2026-10-09").json()
        assert today["checkin"] is None


def test_json_export_includes_the_new_records(auth_client: TestClient) -> None:
    problem(auth_client)
    auth_client.put("/api/checkins", json={"check_date": "2026-10-05", "mood": 4})
    exam(auth_client)
    data = auth_client.get("/api/settings/export.json").json()
    assert data["problems"][0]["title"] == "Two Sum"
    assert data["checkins"][0]["mood"] == 4
    assert data["deadlines"][0]["kind"] == "exam"
    assert len(data["deadlines"][0]["overrides"]) == 6
    assert "weekly_reviews" in data and "commitments" in data
