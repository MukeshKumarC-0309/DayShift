"""The Daily domain: DSA's question target, and domain grouping.

DSA is done at 2 questions OR 120 minutes, whichever comes first. A partial
day is credited the FURTHER of the two routes, never their sum — the user's
explicit choice. 1 question (worth 60 minutes) plus 30 minutes is 50%, not 75%.

October 2026: Thu 1, Fri 2, Sat 3, Sun 4, Mon 5, Tue 6, Wed 7, Thu 8.
The Daily categories run every day, Thursday included.
"""

from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient

from scoring import (
    DayRecord,
    ScoringConfig,
    TargetRule,
    TargetSchedule,
    compute_records,
    credited_minutes,
    parse_day_codes,
)

SDE, DSA, EXERCISE = 1, 4, 5
EVERY_DAY = parse_day_codes("MON,TUE,WED,THU,FRI,SAT,SUN")
CONFIG = ScoringConfig(tracking_start=date(2026, 10, 1))
DSA_RULE = TargetRule(date(2026, 10, 1), 120, EVERY_DAY, question_target=2)


def log(client, day, category, minutes=None, questions=None, override=None):
    payload: dict[str, object] = {
        "log_date": day,
        "category_id": category,
        "clear_override": False,
    }
    if minutes is not None:
        payload["minutes_logged"] = minutes
    if questions is not None:
        payload["questions_solved"] = questions
    if override is not None:
        payload["override_target_minutes"] = override
    return client.put("/api/logs", json=payload)


class TestCreditRule:
    """The one function that encodes 'whichever is further'."""

    @pytest.mark.parametrize(
        ("minutes", "questions", "credited"),
        [
            (30, 1, 60),  # the user's example: further route wins -> 50%
            (0, 2, 120),  # two questions alone finishes the day
            (130, 0, 130),  # minutes alone, over target
            (90, 1, 90),  # minutes further than one question
            (0, 3, 180),  # a third question still counts
            (45, 0, 45),  # no questions: minutes unchanged
        ],
    )
    def test_further_of_the_two_routes(
        self, minutes: int, questions: int, credited: int
    ) -> None:
        assert credited_minutes(minutes, questions, DSA_RULE) == credited

    def test_routes_are_never_added(self) -> None:
        # 1 question (60) + 30 minutes would be 90 if summed. It must be 60.
        assert credited_minutes(30, 1, DSA_RULE) == 60

    def test_minutes_only_category_ignores_questions(self) -> None:
        plain = TargetRule(date(2026, 10, 1), 30, EVERY_DAY)
        assert credited_minutes(10, 5, plain) == 10

    def test_no_rule_means_no_credit(self) -> None:
        assert credited_minutes(10, 5, None) == 10

    def test_conversion_follows_the_rule_in_force(self) -> None:
        # If the target later becomes 90 min / 3 questions, a question is 30.
        later = TargetRule(date(2026, 11, 1), 90, EVERY_DAY, question_target=3)
        assert credited_minutes(0, 1, later) == 30


class TestRecordsUseRealMinutes:
    def test_question_credit_never_inflates_lifetime_totals(self) -> None:
        schedule = TargetSchedule([DSA_RULE])
        # Two questions in 40 real minutes: credited 120, but a 40-minute day.
        records = {"2026-10-05": DayRecord(minutes=120, actual_minutes=40, questions=2)}
        result = compute_records(schedule, records, date(2026, 10, 5), CONFIG)
        assert result.total_minutes == 40
        assert result.best_day_minutes == 40


class TestQuestionsOverHttp:
    def test_questions_are_stored(self, auth_client: TestClient) -> None:
        row = log(auth_client, "2026-10-05", DSA, questions=1).json()
        assert row["questions_solved"] == 1
        assert row["minutes_logged"] == 0

    def test_omitting_questions_keeps_the_stored_count(
        self, auth_client: TestClient
    ) -> None:
        log(auth_client, "2026-10-05", DSA, questions=2)
        row = log(auth_client, "2026-10-05", DSA, minutes=30).json()
        assert row["questions_solved"] == 2
        assert row["minutes_logged"] == 30

    def test_negative_questions_are_rejected(self, auth_client: TestClient) -> None:
        assert log(auth_client, "2026-10-05", DSA, questions=-1).status_code == 422

    def test_today_gauge_reports_the_partial_day(self, auth_client: TestClient) -> None:
        log(auth_client, "2026-10-05", DSA, minutes=30, questions=1)
        progress = auth_client.get("/api/stats/dashboard?today=2026-10-05").json()[
            "progress"
        ]
        dsa = next(p for p in progress if p["category_id"] == DSA)
        assert dsa["minutes_logged"] == 30  # real minutes, shown as worked
        assert dsa["questions_solved"] == 1
        assert dsa["question_target"] == 2
        assert dsa["credited_minutes"] == 60
        assert dsa["percent"] == 50.0

    def test_two_questions_complete_the_day(self, auth_client: TestClient) -> None:
        log(auth_client, "2026-10-05", DSA, minutes=25, questions=2)
        progress = auth_client.get("/api/stats/dashboard?today=2026-10-05").json()[
            "progress"
        ]
        dsa = next(p for p in progress if p["category_id"] == DSA)
        assert dsa["percent"] == 100.0

    def test_par_counts_question_credit(self, auth_client: TestClient) -> None:
        # Oct 5-7: two question-days and one 120-minute day -> 100% par.
        log(auth_client, "2026-10-05", DSA, questions=2)
        log(auth_client, "2026-10-06", DSA, questions=2)
        log(auth_client, "2026-10-07", DSA, minutes=120)
        par = auth_client.get("/api/stats/par?today=2026-10-08").json()
        dsa = next(p for p in par if p["category_id"] == DSA)
        # Window Oct 1-7: 7 days owed (DSA runs every day); 3 done in full.
        assert dsa["target_total"] == 7 * 120
        assert dsa["minutes_total"] == 360

    def test_day_view_shows_questions(self, auth_client: TestClient) -> None:
        log(auth_client, "2026-10-05", DSA, questions=1)
        detail = auth_client.get("/api/stats/day/2026-10-05").json()
        dsa = next(c for c in detail["categories"] if c["category_id"] == DSA)
        assert dsa["questions_solved"] == 1
        assert dsa["percent"] == 50.0

    def test_csv_export_appends_questions(self, auth_client: TestClient) -> None:
        log(auth_client, "2026-10-05", DSA, minutes=10, questions=2)
        lines = auth_client.get("/api/settings/export.csv").text.strip().splitlines()
        header = lines[0].split(",")
        assert header[-1] == "questions_solved"
        row = next(line for line in lines[1:] if ",DSA," in line)
        assert row.split(",")[-1] == "2"


class TestDailyDomainSchedule:
    def test_thursday_counts_for_daily_categories(self, auth_client: TestClient) -> None:
        weekly = auth_client.get("/api/stats/weekly?today=2026-10-08").json()
        exercise = next(w for w in weekly if w["category_id"] == EXERCISE)
        thursday = next(d for d in exercise["days"] if d["log_date"] == "2026-10-08")
        assert thursday["is_active"] is True

    def test_thursday_still_off_for_projects(self, auth_client: TestClient) -> None:
        weekly = auth_client.get("/api/stats/weekly?today=2026-10-08").json()
        sde = next(w for w in weekly if w["category_id"] == SDE)
        thursday = next(d for d in sde["days"] if d["log_date"] == "2026-10-08")
        assert thursday["is_active"] is False


class TestTargetChangesKeepTheQuestionTarget:
    def test_editing_minutes_carries_the_question_target_forward(
        self, auth_client: TestClient
    ) -> None:
        # The category editor does not know about questions; it must not
        # silently drop DSA's second finish line.
        auth_client.post(
            f"/api/categories/{DSA}/targets",
            json={
                "daily_target_minutes": 90,
                "active_days": "MON,TUE,WED,THU,FRI,SAT,SUN",
                "effective_from": "2026-11-01",
            },
        )
        history = auth_client.get(f"/api/categories/{DSA}/targets").json()
        assert history[-1]["daily_target_minutes"] == 90
        assert history[-1]["question_target"] == 2

    def test_zero_removes_the_question_target(self, auth_client: TestClient) -> None:
        auth_client.post(
            f"/api/categories/{DSA}/targets",
            json={
                "daily_target_minutes": 120,
                "active_days": "MON,TUE,WED,THU,FRI,SAT,SUN",
                "effective_from": "2026-11-01",
                "question_target": 0,
            },
        )
        history = auth_client.get(f"/api/categories/{DSA}/targets").json()
        assert history[-1]["question_target"] is None

    def test_past_days_keep_the_old_question_target(
        self, auth_client: TestClient
    ) -> None:
        log(auth_client, "2026-10-05", DSA, questions=1)
        auth_client.post(
            f"/api/categories/{DSA}/targets",
            json={
                "daily_target_minutes": 120,
                "active_days": "MON,TUE,WED,THU,FRI,SAT,SUN",
                "effective_from": "2026-11-01",
                "question_target": 0,
            },
        )
        detail = auth_client.get("/api/stats/day/2026-10-05").json()
        dsa = next(c for c in detail["categories"] if c["category_id"] == DSA)
        assert dsa["percent"] == 50.0  # still scored under 2-question rule


class TestDomains:
    def test_new_category_joins_the_last_domain_by_default(
        self, auth_client: TestClient
    ) -> None:
        created = auth_client.post(
            "/api/categories",
            json={"name": "Reading", "daily_target_minutes": 20, "active_days": "MON"},
        ).json()
        assert created["group_name"] == "Daily"

    def test_a_domain_can_be_named_on_create(self, auth_client: TestClient) -> None:
        created = auth_client.post(
            "/api/categories",
            json={
                "name": "Side Quest",
                "daily_target_minutes": 20,
                "active_days": "MON",
                "group_name": "Projects",
            },
        ).json()
        assert created["group_name"] == "Projects"

    def test_a_category_can_move_domain(self, auth_client: TestClient) -> None:
        moved = auth_client.patch(
            f"/api/categories/{EXERCISE}", json={"group_name": "Projects"}
        ).json()
        assert moved["group_name"] == "Projects"
