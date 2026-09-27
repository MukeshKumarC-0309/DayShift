"""Roadmap: habits, milestones, daily plan, monthly letter, git, calendar import.

Several endpoints act on the real `date.today()` (ticking a habit, finishing a
milestone), so these tests build dates relative to today where they must.
Category ids: 1 SDE, 2 AI, 3 Maint, 4 DSA, 5 Exercise, 6 Coursework.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from datetime import date, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import git_corroboration as gc
import habit_rules as hr
import ics

SDE, AI, MAINT, DSA, EXERCISE, COURSEWORK = 1, 2, 3, 4, 5, 6
TODAY = date.today()


def iso(days_ago: int) -> str:
    return (TODAY - timedelta(days=days_ago)).isoformat()


# --- Habit rules (pure) --------------------------------------------------------

EVERY_DAY = "MON,TUE,WED,THU,FRI,SAT,SUN"
D = date(2026, 10, 5)  # a Monday


class TestHabitRules:
    def rule(
        self, days: str = EVERY_DAY, start: date = date(2026, 10, 1)
    ) -> hr.HabitRule:
        return hr.HabitRule.of(start.isoformat(), days)

    def test_unticked_past_day_is_a_miss(self) -> None:
        assert hr.state_on(self.rule(), D, set(), today=D + timedelta(days=1)) == "missed"

    def test_today_unticked_is_open_not_a_miss(self) -> None:
        assert hr.state_on(self.rule(), D, set(), today=D) == "open"

    def test_days_before_start_are_off(self) -> None:
        rule = self.rule(start=D)
        assert hr.state_on(rule, D - timedelta(days=1), set(), today=D) == "off"

    def test_inactive_weekday_is_off(self) -> None:
        rule = self.rule(days="MON")
        tuesday = D + timedelta(days=1)
        assert hr.state_on(rule, tuesday, set(), today=tuesday) == "off"

    def test_streak_counts_back_and_stops_at_a_miss(self) -> None:
        # Done Mon-Wed, missed Thu, done Fri-Sun; today is Sunday, done.
        checked = {D + timedelta(days=i) for i in (0, 1, 2, 4, 5, 6)}
        today = D + timedelta(days=6)
        assert hr.current_streak(self.rule(), checked, today) == 3
        assert hr.best_streak(self.rule(), checked, today) == 3

    def test_open_today_does_not_break_the_streak(self) -> None:
        checked = {D, D + timedelta(days=1)}
        today = D + timedelta(days=2)
        assert hr.current_streak(self.rule(), checked, today) == 2

    def test_inactive_days_never_break_a_streak(self) -> None:
        rule = self.rule(days="MON,WED")
        checked = {D, D + timedelta(days=2)}  # Mon, Wed; Tue is off
        assert hr.current_streak(rule, checked, D + timedelta(days=3)) == 2

    def test_rate_excludes_open_today(self) -> None:
        checked = {D}
        r = hr.rate(
            self.rule(), checked, D, D + timedelta(days=1), today=D + timedelta(days=1)
        )
        assert (r.done, r.applicable) == (1, 1)


# --- Habits over HTTP ----------------------------------------------------------


def habit(client: TestClient, **body: object) -> dict:
    payload: dict[str, object] = {"name": "No phone first hour"}
    payload.update(body)
    response = client.post("/api/goals/habits", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


class TestHabits:
    def test_new_habit_starts_today_with_no_misses(self, auth_client: TestClient) -> None:
        created = habit(auth_client)
        assert created["start_date"] == TODAY.isoformat()
        assert created["today"] == "open"
        assert all(d["state"] in ("off", "open") for d in created["days"])

    def test_unticked_days_are_missed(self, auth_client: TestClient) -> None:
        created = habit(auth_client, start_date=iso(3))
        states = {d["day"]: d["state"] for d in created["days"]}
        assert states[iso(1)] == "missed"
        assert states[iso(3)] == "missed"
        assert created["rate_30"] == 0.0

    def test_ticking_builds_a_streak(self, auth_client: TestClient) -> None:
        created = habit(auth_client, start_date=iso(2))
        for days_ago in (2, 1, 0):
            response = auth_client.put(
                f"/api/goals/habits/{created['id']}/checks/{iso(days_ago)}",
                json={"done": True},
            )
        body = response.json()
        assert body["current_streak"] == 3
        assert body["today"] == "done"

    def test_untick(self, auth_client: TestClient) -> None:
        created = habit(auth_client)
        url = f"/api/goals/habits/{created['id']}/checks/{iso(0)}"
        auth_client.put(url, json={"done": True})
        assert auth_client.put(url, json={"done": False}).json()["today"] == "open"

    def test_future_cannot_be_ticked(self, auth_client: TestClient) -> None:
        created = habit(auth_client)
        tomorrow = (TODAY + timedelta(days=1)).isoformat()
        response = auth_client.put(
            f"/api/goals/habits/{created['id']}/checks/{tomorrow}", json={"done": True}
        )
        assert response.status_code == 422

    def test_bad_days_are_rejected(self, auth_client: TestClient) -> None:
        response = auth_client.post(
            "/api/goals/habits", json={"name": "X", "active_days": "FUNDAY"}
        )
        assert response.status_code == 422

    def test_archive_hides_it(self, auth_client: TestClient) -> None:
        created = habit(auth_client)
        auth_client.patch(f"/api/goals/habits/{created['id']}", json={"archived": True})
        assert auth_client.get("/api/goals/habits").json() == []
        assert len(auth_client.get("/api/goals/habits?include_archived=true").json()) == 1


# --- Milestones -----------------------------------------------------------------


class TestMilestones:
    def test_create_finish_and_reopen(self, auth_client: TestClient) -> None:
        m = auth_client.post(
            "/api/goals/milestones", json={"category_id": SDE, "title": "Auth done"}
        ).json()
        assert m["done_on"] is None
        done = auth_client.patch(f"/api/goals/milestones/{m['id']}", json={"done": True})
        assert done.json()["done_on"] == TODAY.isoformat()
        undone = auth_client.patch(
            f"/api/goals/milestones/{m['id']}", json={"done": False}
        )
        assert undone.json()["done_on"] is None

    def test_done_range_filter(self, auth_client: TestClient) -> None:
        for title, day in [("A", "2026-10-02"), ("B", "2026-10-20")]:
            m = auth_client.post(
                "/api/goals/milestones", json={"category_id": SDE, "title": title}
            ).json()
            auth_client.patch(f"/api/goals/milestones/{m['id']}", json={"done_on": day})
        hits = auth_client.get(
            "/api/goals/milestones?done_from=2026-10-01&done_to=2026-10-07"
        ).json()
        assert [m["title"] for m in hits] == ["A"]

    def test_open_ones_come_first(self, auth_client: TestClient) -> None:
        first = auth_client.post(
            "/api/goals/milestones", json={"category_id": SDE, "title": "Done one"}
        ).json()
        auth_client.patch(f"/api/goals/milestones/{first['id']}", json={"done": True})
        auth_client.post(
            "/api/goals/milestones", json={"category_id": SDE, "title": "Open"}
        )
        titles = [m["title"] for m in auth_client.get("/api/goals/milestones").json()]
        assert titles == ["Open", "Done one"]

    def test_unknown_category(self, auth_client: TestClient) -> None:
        response = auth_client.post(
            "/api/goals/milestones", json={"category_id": 99, "title": "X"}
        )
        assert response.status_code == 404


# --- Daily plan ------------------------------------------------------------------


class TestPlan:
    def test_minutes_replace_and_zero_removes(self, auth_client: TestClient) -> None:
        day = iso(-1)  # tomorrow
        auth_client.put(
            f"/api/plan/{day}/minutes",
            json={
                "items": [
                    {"category_id": SDE, "minutes": 120},
                    {"category_id": DSA, "minutes": 60},
                ]
            },
        )
        plan = auth_client.put(
            f"/api/plan/{day}/minutes",
            json={"items": [{"category_id": SDE, "minutes": 90}]},
        ).json()
        planned = {r["category_id"]: r["planned"] for r in plan["categories"]}
        assert planned[SDE] == 90
        assert planned[DSA] is None
        assert plan["planned_total"] == 90
        assert plan["actual_total"] is None  # the day has not started

    def test_actual_is_real_minutes_not_question_credit(
        self, auth_client: TestClient
    ) -> None:
        day = iso(1)
        auth_client.put(
            "/api/logs",
            json={
                "log_date": day,
                "category_id": DSA,
                "minutes_logged": 20,
                "questions_solved": 2,
            },
        )
        auth_client.put(
            f"/api/plan/{day}/minutes",
            json={"items": [{"category_id": DSA, "minutes": 60}]},
        )
        plan = auth_client.get(f"/api/plan/{day}").json()
        dsa = next(r for r in plan["categories"] if r["category_id"] == DSA)
        assert dsa["actual"] == 20  # not the 120 credited by two questions

    def test_tasks_and_carry_over_copies_undone_once(
        self, auth_client: TestClient
    ) -> None:
        yesterday, today = iso(1), iso(0)
        a = auth_client.post(
            f"/api/plan/{yesterday}/tasks", json={"text": "Auth PR"}
        ).json()
        auth_client.post(f"/api/plan/{yesterday}/tasks", json={"text": "OS notes"})
        auth_client.patch(f"/api/plan/tasks/{a['id']}", json={"done": True})
        auth_client.post(f"/api/plan/{today}/carry-over")
        carried = auth_client.post(f"/api/plan/{today}/carry-over").json()
        assert [t["text"] for t in carried] == ["OS notes"]
        # Copied, not moved: yesterday still shows it undone.
        old = auth_client.get(f"/api/plan/{yesterday}").json()["tasks"]
        assert {t["text"]: t["done"] for t in old} == {"Auth PR": True, "OS notes": False}

    def test_delete_task(self, auth_client: TestClient) -> None:
        t = auth_client.post(f"/api/plan/{iso(0)}/tasks", json={"text": "X"}).json()
        assert auth_client.delete(f"/api/plan/tasks/{t['id']}").status_code == 204
        assert auth_client.get(f"/api/plan/{iso(0)}").json()["tasks"] == []


# --- Monthly letter -----------------------------------------------------------------


class TestLetter:
    def test_bad_month(self, auth_client: TestClient) -> None:
        assert auth_client.get("/api/letter/2026-13").status_code == 422

    def test_future_month(self, auth_client: TestClient) -> None:
        future = TODAY.replace(day=1) + timedelta(days=62)
        response = auth_client.get(f"/api/letter/{future.year:04d}-{future.month:02d}")
        assert response.status_code == 422

    def test_a_past_month_sums_up(self, auth_client: TestClient) -> None:
        # October 2026 has fully passed only if today is later; otherwise use
        # the logic on whatever month contains 40 days ago.
        anchor = TODAY - timedelta(days=40)
        month = f"{anchor.year:04d}-{anchor.month:02d}"
        day = anchor.isoformat()
        auth_client.put(
            "/api/logs",
            json={"log_date": day, "category_id": SDE, "minutes_logged": 150},
        )
        auth_client.put("/api/checkins", json={"check_date": day, "sleep_minutes": 420})
        m = auth_client.post(
            "/api/goals/milestones", json={"category_id": SDE, "title": "Shipped"}
        ).json()
        auth_client.patch(f"/api/goals/milestones/{m['id']}", json={"done_on": day})
        letter = auth_client.get(f"/api/letter/{month}").json()
        sde = next(c for c in letter["categories"] if c["category_id"] == SDE)
        assert sde["minutes"] == 150
        assert sde["best_day"] == day
        assert letter["total_minutes"] >= 150
        assert letter["checkins"] == 1
        assert letter["average_sleep_minutes"] == 420
        assert [x["title"] for x in letter["milestones_done"]] == ["Shipped"]

    def test_months_list(self, auth_client: TestClient) -> None:
        months = auth_client.get("/api/letter/months").json()
        assert months[0] == f"{TODAY.year:04d}-{TODAY.month:02d}"


# --- Calendar (.ics) -----------------------------------------------------------------

ICS = "\r\n".join(
    [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "UID:1@x",
        "DTSTART;VALUE=DATE:20261014",
        "SUMMARY:OS Midterm",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:2@x",
        "DTSTART;TZID=Asia/Kolkata:20261020T093000",
        # Folding drops exactly one leading space, so the space between
        # "record" and "submission" sits before the fold.
        "SUMMARY:DBMS lab\\, record ",
        " submission",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "DTSTART:20261021T030000Z",
        "SUMMARY:Lecture",
        "RRULE:FREQ=WEEKLY",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "DTSTART:20261022",
        "END:VEVENT",
        "END:VCALENDAR",
    ]
)


class TestIcs:
    def test_parses_dates_titles_and_folding(self) -> None:
        events = ics.parse(ICS)
        assert [e.title for e in events] == [
            "OS Midterm",
            "DBMS lab, record submission",
            "Lecture",
        ]
        assert events[0].day == date(2026, 10, 14)
        assert events[1].day == date(2026, 10, 20)
        assert events[2].recurring is True

    @pytest.mark.parametrize(
        "title",
        [
            "CN mid-sem",
            "OS midsem",
            "DBMS end sem",
            "Maths quiz",
            "Physics viva",
            "Finals",
        ],
    )
    def test_exam_words(self, title: str) -> None:
        assert ics.Event(uid=None, title=title, day=D, recurring=False).looks_like_exam

    def test_exam_guess(self) -> None:
        by_title = {e.title: e for e in ics.parse(ICS)}
        assert by_title["OS Midterm"].looks_like_exam is True
        assert by_title["Lecture"].looks_like_exam is False

    def test_endpoint_lists_only_upcoming(self, auth_client: TestClient) -> None:
        past = (TODAY - timedelta(days=3)).strftime("%Y%m%d")
        soon = (TODAY + timedelta(days=5)).strftime("%Y%m%d")
        text = "\n".join(
            [
                "BEGIN:VEVENT",
                f"DTSTART;VALUE=DATE:{past}",
                "SUMMARY:Old exam",
                "END:VEVENT",
                "BEGIN:VEVENT",
                f"DTSTART;VALUE=DATE:{soon}",
                "SUMMARY:Networks quiz",
                "END:VEVENT",
            ]
        )
        out = auth_client.post("/api/agenda/import-ics", json={"text": text}).json()
        assert [e["title"] for e in out] == ["Networks quiz"]
        assert out[0]["looks_like_exam"] is True
        assert out[0]["already_added"] is False

    def test_already_added_is_marked(self, auth_client: TestClient) -> None:
        soon = TODAY + timedelta(days=5)
        auth_client.post(
            "/api/agenda/deadlines",
            json={
                "title": "Networks quiz",
                "kind": "other",
                "due_date": soon.isoformat(),
            },
        )
        text = (
            f"BEGIN:VEVENT\nDTSTART;VALUE=DATE:{soon.strftime('%Y%m%d')}\n"
            "SUMMARY:Networks quiz\nEND:VEVENT"
        )
        out = auth_client.post("/api/agenda/import-ics", json={"text": text}).json()
        assert out[0]["already_added"] is True


# --- Git corroboration ---------------------------------------------------------------

needs_git = pytest.mark.skipif(shutil.which("git") is None, reason="git not installed")


def make_repo(root: Path, commit_days: list[str]) -> Path:
    repo = root / "repo"
    repo.mkdir()
    env = {
        **os.environ,
        "GIT_CONFIG_GLOBAL": os.devnull,
        "GIT_CONFIG_SYSTEM": os.devnull,
    }

    def git(*args: str, extra: dict[str, str] | None = None) -> None:
        subprocess.run(
            ["git", "-C", str(repo), *args],
            check=True,
            capture_output=True,
            env={**env, **(extra or {})},
        )

    git("init", "-q")
    git("config", "user.email", "me@example.com")
    git("config", "user.name", "Me")
    git("config", "commit.gpgsign", "false")
    for i, day in enumerate(commit_days):
        (repo / f"f{i}.txt").write_text(str(i))
        git("add", ".")
        stamp = f"{day}T12:00:00"
        git(
            "commit",
            "-q",
            "-m",
            f"c{i}",
            extra={"GIT_AUTHOR_DATE": stamp, "GIT_COMMITTER_DATE": stamp},
        )
    return repo


@needs_git
class TestGit:
    def test_commits_by_day(self, tmp_path: Path) -> None:
        repo = make_repo(tmp_path, [iso(3), iso(3), iso(2)])
        counts = gc.commits_by_day(repo, TODAY - timedelta(days=5), TODAY)
        assert counts == {iso(3): 2, iso(2): 1}

    def test_not_a_repo(self, tmp_path: Path) -> None:
        with pytest.raises(gc.GitError):
            gc.validate_repo(tmp_path)

    def test_flags(self) -> None:
        assert gc.DayComparison("d", 90, 0).flag == "logged_no_commits"
        assert gc.DayComparison("d", 0, 3).flag == "commits_not_logged"
        assert gc.DayComparison("d", 30, 0).flag is None  # under the threshold
        assert gc.DayComparison("d", 120, 2).flag is None

    def test_endpoint_compares_logs_with_commits(
        self, auth_client: TestClient, tmp_path: Path
    ) -> None:
        repo = make_repo(tmp_path, [iso(2)])
        added = auth_client.post(
            "/api/corroboration/repos", json={"path": str(repo), "category_id": SDE}
        )
        assert added.status_code == 201, added.text
        auth_client.put(
            "/api/logs",
            json={"log_date": iso(3), "category_id": SDE, "minutes_logged": 120},
        )
        out = auth_client.get("/api/corroboration?days=7").json()
        sde = out[0]
        by_day = {d["day"]: d for d in sde["days"]}
        assert by_day[iso(3)]["flag"] == "logged_no_commits"
        assert by_day[iso(2)]["flag"] == "commits_not_logged"
        assert sde["total_commits"] == 1

    def test_rejects_a_folder_that_is_not_a_repo(
        self, auth_client: TestClient, tmp_path: Path
    ) -> None:
        response = auth_client.post(
            "/api/corroboration/repos", json={"path": str(tmp_path), "category_id": SDE}
        )
        assert response.status_code == 422

    def test_duplicate_repo(self, auth_client: TestClient, tmp_path: Path) -> None:
        repo = make_repo(tmp_path, [iso(2)])
        body = {"path": str(repo), "category_id": SDE}
        auth_client.post("/api/corroboration/repos", json=body)
        assert auth_client.post("/api/corroboration/repos", json=body).status_code == 409


def test_json_export_includes_roadmap_records(auth_client: TestClient) -> None:
    habit(auth_client)
    auth_client.post("/api/goals/milestones", json={"category_id": SDE, "title": "M"})
    auth_client.post(f"/api/plan/{iso(0)}/tasks", json={"text": "T"})
    data = auth_client.get("/api/settings/export.json").json()
    assert data["habits"][0]["name"] == "No phone first hour"
    assert data["milestones"][0]["title"] == "M"
    assert data["plan_tasks"][0]["text"] == "T"
    assert data["git_repos"] == []


def test_today_line_carries_habits_and_plan(auth_client: TestClient) -> None:
    h = habit(auth_client)
    auth_client.put(f"/api/goals/habits/{h['id']}/checks/{iso(0)}", json={"done": True})
    habit(auth_client, name="Read 10 pages")
    auth_client.post(f"/api/plan/{iso(0)}/tasks", json={"text": "Auth PR"})
    auth_client.put(
        f"/api/plan/{iso(0)}/minutes",
        json={"items": [{"category_id": DSA, "minutes": 90}]},
    )
    today = auth_client.get(f"/api/agenda/today?today={iso(0)}").json()
    assert [(x["name"], x["done"]) for x in today["habits"]] == [
        ("No phone first hour", True),
        ("Read 10 pages", False),
    ]
    assert today["plan_open_tasks"] == 1
    assert today["plan_minutes"] == 90


def make_branch_repo(root: Path) -> Path:
    """Build a repo with commits on main, on feature/auth, and one mentioning #42."""
    repo = root / "branchy"
    repo.mkdir()
    env = {
        **os.environ,
        "GIT_CONFIG_GLOBAL": os.devnull,
        "GIT_CONFIG_SYSTEM": os.devnull,
    }

    def git(*args: str, when: str | None = None) -> None:
        extra = {"GIT_AUTHOR_DATE": when, "GIT_COMMITTER_DATE": when} if when else {}
        subprocess.run(
            ["git", "-C", str(repo), *args],
            check=True,
            capture_output=True,
            env={**env, **extra},
        )

    git("init", "-q", "-b", "main")
    git("config", "user.email", "me@example.com")
    git("config", "user.name", "Me")
    git("config", "commit.gpgsign", "false")
    day = f"{iso(1)}T10:00:00"

    def commit(name: str, message: str) -> None:
        (repo / name).write_text(message)
        git("add", ".")
        git("commit", "-q", "-m", message, when=day)

    commit("a.txt", "base")
    git("checkout", "-q", "-b", "feature/auth")
    commit("b.txt", "auth: token")
    commit("c.txt", "auth: refresh")
    git("checkout", "-q", "main")
    commit("d.txt", "fix login loop (#42)")
    commit("e.txt", "unrelated #420")
    return repo


@needs_git
class TestBranchCommits:
    def test_branch_and_issue_counts(self, tmp_path: Path) -> None:
        repo = make_branch_repo(tmp_path)
        day = TODAY - timedelta(days=1)
        # base + 2 on the branch; #42 matches once, not #420.
        assert gc.ref_commits(repo, "feature/auth", day) == 3
        assert gc.ref_commits(repo, "#42", day) == 1
        assert gc.ref_commits(repo, "42", day) == 1
        assert gc.ref_commits(repo, "feature/nope", day) is None
        assert gc.ref_commits(repo, "feature/auth", TODAY) == 0

    def test_an_option_like_ref_is_refused(self, tmp_path: Path) -> None:
        repo = make_branch_repo(tmp_path)
        assert gc.ref_commits(repo, "--output=/tmp/x", TODAY) is None

    def test_endpoint_reports_per_session(
        self, auth_client: TestClient, tmp_path: Path
    ) -> None:
        repo = make_branch_repo(tmp_path)
        auth_client.post(
            "/api/corroboration/repos", json={"path": str(repo), "category_id": SDE}
        )
        day = iso(1)
        for start, ref in (
            ("09:00", "feature/auth"),
            ("11:00", "#42"),
            ("13:00", "nope"),
        ):
            auth_client.post(
                "/api/sessions",
                json={
                    "category_id": SDE,
                    "log_date": day,
                    "minutes": 30,
                    "started_at": f"{day}T{start}",
                    "git_ref": ref,
                },
            )
        rows = auth_client.get(f"/api/corroboration/day/{day}").json()
        assert [(r["git_ref"], r["commits"]) for r in rows] == [
            ("feature/auth", 3),
            ("#42", 1),
            ("nope", None),
        ]
