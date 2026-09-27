"""Batch 5: pace, records, weekly review, commitments, honesty ledger.

October 2026 reference: Thu 1, Fri 2, Sat 3, Sun 4, Mon 5, Tue 6, Wed 7,
Thu 8, Fri 9, Sat 10, Sun 11. Thursday is inactive for SDE and AI Automation.
The week of Mon 5 runs Mon 5 - Sun 11.
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
    current_streak_at_or_above,
    parse_day_codes,
    week_pace,
    week_start,
)

SDE, AI, MAINTENANCE = 1, 2, 3

WEEKDAYS = parse_day_codes("MON,TUE,WED,FRI,SAT,SUN")
CONFIG = ScoringConfig(tracking_start=date(2026, 10, 1))


def schedule(target: int = 180, days=WEEKDAYS) -> TargetSchedule:
    return TargetSchedule([TargetRule(date(2026, 10, 1), target, days)])


def records(**kwargs: int) -> dict[str, DayRecord]:
    out: dict[str, DayRecord] = {}
    for key, minutes in kwargs.items():
        out[key[1:].replace("_", "-")] = DayRecord(minutes=minutes)
    return out


def stamp_override(tmp_path, log_date: str, category_id: int, when: str) -> None:
    """Force when an override was recorded.

    The ledger compares `override_set_at` (a real wall-clock stamp) against the
    day it governs, so testing the rule means controlling that stamp rather
    than the simulated `today`.
    """
    import sqlite3

    con = sqlite3.connect(tmp_path / "api.db")
    con.execute(
        "UPDATE daily_logs SET override_set_at = ? "
        "WHERE log_date = ? AND category_id = ?",
        (when, log_date, category_id),
    )
    con.commit()
    con.close()


def upsert(client, day, category, minutes=None, override=None, reason=None):
    payload: dict[str, object] = {
        "log_date": day,
        "category_id": category,
        "clear_override": False,
    }
    if minutes is not None:
        payload["minutes_logged"] = minutes
    if override is not None:
        payload["override_target_minutes"] = override
    if reason is not None:
        payload["override_reason"] = reason
    return client.put("/api/logs", json=payload)


class TestWeekStart:
    @pytest.mark.parametrize(
        ("day", "expected"),
        [
            (date(2026, 10, 5), date(2026, 10, 5)),  # Monday maps to itself
            (date(2026, 10, 8), date(2026, 10, 5)),  # Thursday
            (date(2026, 10, 11), date(2026, 10, 5)),  # Sunday still that week
            (date(2026, 10, 12), date(2026, 10, 12)),  # next Monday
        ],
    )
    def test_monday_of_the_iso_week(self, day: date, expected: date) -> None:
        assert week_start(day) == expected


class TestWeekPace:
    """Pace answers 'what do I do today', so it includes today and looks ahead."""

    def test_counts_the_whole_week_including_days_not_yet_reached(self) -> None:
        # Week Mon 5 - Sun 11; SDE is active on 6 of those (not Thursday 8).
        pace = week_pace(schedule(), {}, date(2026, 10, 5), CONFIG)
        assert pace.week_start == "2026-10-05"
        assert pace.week_end == "2026-10-11"
        assert pace.target_total == 6 * 180

    def test_days_remaining_counts_today_onward_only(self) -> None:
        # Standing on Friday 9: Fri, Sat, Sun remain (Thu 8 is inactive anyway).
        pace = week_pace(schedule(), {}, date(2026, 10, 9), CONFIG)
        assert pace.days_remaining == 3

    def test_past_days_count_toward_the_requirement_but_not_the_split(self) -> None:
        # Missed Mon-Wed entirely; standing on Friday.
        pace = week_pace(schedule(), {}, date(2026, 10, 9), CONFIG)
        assert pace.minutes_remaining == 6 * 180
        # The whole week's shortfall now has to fit into 3 days.
        assert pace.minutes_per_remaining_day == 360

    def test_logged_minutes_reduce_what_is_left(self) -> None:
        logged = records(d2026_10_05=180, d2026_10_06=180, d2026_10_07=180)
        pace = week_pace(schedule(), logged, date(2026, 10, 9), CONFIG)
        assert pace.minutes_logged == 540
        assert pace.minutes_remaining == 540
        assert pace.minutes_per_remaining_day == 180

    def test_rounds_up_so_the_split_actually_reaches_the_target(self) -> None:
        # 100 minutes over 3 days is 33.3; 33/day would fall short.
        logged = records(d2026_10_05=980)
        pace = week_pace(schedule(), logged, date(2026, 10, 9), CONFIG)
        assert pace.minutes_remaining == 100
        assert pace.minutes_per_remaining_day == 34

    def test_on_track_once_the_week_target_is_met(self) -> None:
        logged = records(d2026_10_05=1080)
        pace = week_pace(schedule(), logged, date(2026, 10, 9), CONFIG)
        assert pace.on_track is True
        assert pace.minutes_remaining == 0
        assert pace.minutes_per_remaining_day == 0

    def test_no_remaining_days_reports_none_rather_than_dividing_by_zero(self) -> None:
        weekend_only = schedule(target=20, days=parse_day_codes("SAT,SUN"))
        # Monday 12 — the previous week's Sat/Sun are both behind us.
        pace = week_pace(weekend_only, {}, date(2026, 10, 12), CONFIG)
        assert pace.days_remaining == 2  # Sat 17 / Sun 18 of the new week
        # A Sunday evening, with only Sunday left and it already counted.
        late = week_pace(weekend_only, {}, date(2026, 10, 11), CONFIG)
        assert late.days_remaining == 1


class TestCurrentStreak:
    def test_today_counts_only_once_it_already_meets_the_target(self) -> None:
        # Mon-Wed met; today (Thu 8) is inactive so it is stepped over.
        logged = records(d2026_10_05=180, d2026_10_06=180, d2026_10_07=180)
        assert (
            current_streak_at_or_above(schedule(), logged, date(2026, 10, 8), CONFIG) == 3
        )

    def test_an_unfinished_today_does_not_break_the_streak(self) -> None:
        # Today (Wed 7) has only 10 minutes so far — yesterday's run stands.
        logged = records(d2026_10_05=180, d2026_10_06=180, d2026_10_07=10)
        assert (
            current_streak_at_or_above(schedule(), logged, date(2026, 10, 7), CONFIG) == 2
        )

    def test_a_completed_today_extends_the_streak(self) -> None:
        logged = records(d2026_10_05=180, d2026_10_06=180, d2026_10_07=180)
        assert (
            current_streak_at_or_above(schedule(), logged, date(2026, 10, 7), CONFIG) == 3
        )

    def test_a_missed_day_ends_it(self) -> None:
        logged = records(d2026_10_05=180, d2026_10_06=10, d2026_10_07=180)
        assert (
            current_streak_at_or_above(schedule(), logged, date(2026, 10, 7), CONFIG) == 1
        )


class TestRecords:
    def test_bests_are_computed_over_history(self) -> None:
        logged = records(
            d2026_10_02=200, d2026_10_03=300, d2026_10_04=100, d2026_10_05=180
        )
        result = compute_records(schedule(), logged, date(2026, 10, 5), CONFIG)
        assert result.best_day == "2026-10-03"
        assert result.best_day_minutes == 300
        assert result.total_minutes == 780

    def test_best_week_groups_by_iso_week(self) -> None:
        # Oct 2-4 fall in the week of Mon Sep 28; Oct 5 starts a new week.
        logged = records(
            d2026_10_02=200, d2026_10_03=300, d2026_10_04=100, d2026_10_05=250
        )
        result = compute_records(schedule(), logged, date(2026, 10, 5), CONFIG)
        assert result.best_week == "2026-09-28"
        assert result.best_week_minutes == 600

    def test_days_after_today_are_ignored(self) -> None:
        # A future override row must not inflate lifetime totals.
        logged = records(d2026_10_05=180, d2026_10_20=999)
        result = compute_records(schedule(), logged, date(2026, 10, 5), CONFIG)
        assert result.total_minutes == 180


class TestPaceApi:
    def test_pace_endpoint(self, auth_client: TestClient) -> None:
        body = auth_client.get(
            "/api/accountability/pace", params={"today": "2026-10-09"}
        ).json()
        sde = next(p for p in body if p["category_id"] == SDE)
        assert sde["week_start"] == "2026-10-05"
        assert sde["days_remaining"] == 3
        assert sde["minutes_per_remaining_day"] is not None

    def test_pace_reflects_logged_minutes(self, auth_client: TestClient) -> None:
        upsert(auth_client, "2026-10-05", SDE, minutes=180)
        body = auth_client.get(
            "/api/accountability/pace", params={"today": "2026-10-09"}
        ).json()
        sde = next(p for p in body if p["category_id"] == SDE)
        assert sde["minutes_logged"] == 180

    def test_requires_a_session(self, configured_client: TestClient) -> None:
        configured_client.post("/api/auth/logout")
        assert configured_client.get("/api/accountability/pace").status_code == 401


class TestRecordsApi:
    def test_records_endpoint(self, auth_client: TestClient) -> None:
        for day in ("2026-10-02", "2026-10-03", "2026-10-04"):
            upsert(auth_client, day, SDE, minutes=180)
        body = auth_client.get(
            "/api/accountability/records", params={"today": "2026-10-05"}
        ).json()
        sde = next(r for r in body if r["category_id"] == SDE)
        assert sde["total_minutes"] == 540
        assert sde["longest_streak"] == 3


class TestWeeklyReview:
    def test_defaults_to_the_last_completed_week(self, auth_client: TestClient) -> None:
        # Standing on Wed 7 Oct, the finished week is Mon 28 Sep - Sun 4 Oct.
        body = auth_client.get(
            "/api/accountability/review", params={"today": "2026-10-07"}
        ).json()
        assert body["week_start"] == "2026-09-28"
        assert body["is_current_week"] is False

    def test_a_specific_week_can_be_requested(self, auth_client: TestClient) -> None:
        body = auth_client.get(
            "/api/accountability/review",
            params={"week_start": "2026-10-08", "today": "2026-10-09"},
        ).json()
        # Any day in the week resolves to its Monday.
        assert body["week_start"] == "2026-10-05"
        assert body["is_current_week"] is True

    def test_reflection_round_trip(self, auth_client: TestClient) -> None:
        response = auth_client.put(
            "/api/accountability/review",
            json={"week_start": "2026-10-05", "reflection": "Lost Tuesday to a lab."},
        )
        assert response.status_code == 200
        assert response.json()["reflection"] == "Lost Tuesday to a lab."

        again = auth_client.get(
            "/api/accountability/review", params={"week_start": "2026-10-05"}
        ).json()
        assert again["reflection"] == "Lost Tuesday to a lab."
        assert again["reviewed_at"] is not None

    def test_saving_twice_updates_rather_than_duplicating(
        self, auth_client: TestClient
    ) -> None:
        for text in ("first", "second"):
            auth_client.put(
                "/api/accountability/review",
                json={"week_start": "2026-10-05", "reflection": text},
            )
        body = auth_client.get(
            "/api/accountability/review", params={"week_start": "2026-10-05"}
        ).json()
        assert body["reflection"] == "second"

    def test_week_totals_are_reported(self, auth_client: TestClient) -> None:
        upsert(auth_client, "2026-10-05", SDE, minutes=180)
        upsert(auth_client, "2026-10-06", SDE, minutes=90)
        body = auth_client.get(
            "/api/accountability/review", params={"week_start": "2026-10-05"}
        ).json()
        sde = next(c for c in body["categories"] if c["category_id"] == SDE)
        assert sde["minutes_logged"] == 270
        assert sde["best_day"] == "2026-10-05"


class TestCommitments:
    def test_set_and_compare_against_actual(self, auth_client: TestClient) -> None:
        upsert(auth_client, "2026-10-05", SDE, minutes=400)
        body = auth_client.put(
            "/api/accountability/commitments",
            json={"week_start": "2026-10-05", "category_id": SDE, "minutes": 900},
        ).json()
        sde = next(c for c in body if c["category_id"] == SDE)
        assert sde["committed_minutes"] == 900
        assert sde["actual_minutes"] == 400
        assert sde["delta_minutes"] == -500
        assert sde["kept"] is False

    def test_kept_when_actual_meets_the_promise(self, auth_client: TestClient) -> None:
        upsert(auth_client, "2026-10-05", SDE, minutes=400)
        body = auth_client.put(
            "/api/accountability/commitments",
            json={"week_start": "2026-10-05", "category_id": SDE, "minutes": 300},
        ).json()
        assert next(c for c in body if c["category_id"] == SDE)["kept"] is True

    def test_no_commitment_reports_none_rather_than_zero(
        self, auth_client: TestClient
    ) -> None:
        body = auth_client.get(
            "/api/accountability/review", params={"week_start": "2026-10-05"}
        ).json()
        assert all(c["committed_minutes"] is None for c in body["commitments"])
        assert all(c["kept"] is None for c in body["commitments"])

    def test_setting_twice_replaces(self, auth_client: TestClient) -> None:
        for minutes in (900, 600):
            auth_client.put(
                "/api/accountability/commitments",
                json={"week_start": "2026-10-05", "category_id": SDE, "minutes": minutes},
            )
        body = auth_client.get(
            "/api/accountability/review", params={"week_start": "2026-10-05"}
        ).json()
        sde = next(c for c in body["commitments"] if c["category_id"] == SDE)
        assert sde["committed_minutes"] == 600

    def test_any_day_of_the_week_resolves_to_its_monday(
        self, auth_client: TestClient
    ) -> None:
        auth_client.put(
            "/api/accountability/commitments",
            json={"week_start": "2026-10-08", "category_id": SDE, "minutes": 500},
        )
        body = auth_client.get(
            "/api/accountability/review", params={"week_start": "2026-10-05"}
        ).json()
        sde = next(c for c in body["commitments"] if c["category_id"] == SDE)
        assert sde["committed_minutes"] == 500

    def test_unknown_category_is_rejected(self, auth_client: TestClient) -> None:
        response = auth_client.put(
            "/api/accountability/commitments",
            json={"week_start": "2026-10-05", "category_id": 999, "minutes": 100},
        )
        assert response.status_code == 404

    def test_clear_commitment(self, auth_client: TestClient) -> None:
        auth_client.put(
            "/api/accountability/commitments",
            json={"week_start": "2026-10-05", "category_id": SDE, "minutes": 900},
        )
        assert (
            auth_client.delete(
                f"/api/accountability/commitments/2026-10-05/{SDE}"
            ).status_code
            == 204
        )


class TestHonestyLedger:
    """Surfacing retroactive target changes, not preventing them."""

    def test_empty_when_nothing_has_been_overridden(
        self, auth_client: TestClient
    ) -> None:
        body = auth_client.get("/api/accountability/ledger").json()
        assert body["total_retroactive"] == 0

    def test_an_override_set_in_advance_is_not_listed(
        self, auth_client: TestClient
    ) -> None:
        # Setting tomorrow's target today is planning, not revisionism.
        future = "2099-01-01"
        upsert(auth_client, future, SDE, override=0, reason="Travelling")
        body = auth_client.get("/api/accountability/ledger").json()
        assert body["total_retroactive"] == 0

    def test_a_retroactive_override_is_listed(
        self, auth_client: TestClient, tmp_path
    ) -> None:
        upsert(auth_client, "2026-10-05", SDE, minutes=20, override=30, reason="Ill")
        # Recorded six days after the day it governs.
        stamp_override(tmp_path, "2026-10-05", SDE, "2026-10-11T21:00:00")
        body = auth_client.get(
            "/api/accountability/ledger", params={"today": "2026-10-20"}
        ).json()
        assert body["total_retroactive"] == 1
        entry = body["entries"][0]
        assert entry["log_date"] == "2026-10-05"
        assert entry["override_target"] == 30
        assert entry["scheduled_target"] == 180
        assert entry["lowered"] is True
        assert entry["override_reason"] == "Ill"
        assert entry["days_late"] == 6

    def test_a_raised_target_is_listed_but_not_flagged_as_lowered(
        self, auth_client: TestClient, tmp_path
    ) -> None:
        # Raising the bar retroactively is not the dishonest direction.
        upsert(auth_client, "2026-10-05", SDE, minutes=300, override=280)
        stamp_override(tmp_path, "2026-10-05", SDE, "2026-10-11T21:00:00")
        body = auth_client.get(
            "/api/accountability/ledger", params={"today": "2026-10-20"}
        ).json()
        assert body["total_retroactive"] == 1
        assert body["total_lowered"] == 0
        assert body["entries"][0]["lowered"] is False

    def test_clearing_an_override_removes_it_from_the_ledger(
        self, auth_client: TestClient, tmp_path
    ) -> None:
        upsert(auth_client, "2026-10-05", SDE, minutes=20, override=30)
        stamp_override(tmp_path, "2026-10-05", SDE, "2026-10-11T21:00:00")
        auth_client.put(
            "/api/logs",
            json={"log_date": "2026-10-05", "category_id": SDE, "clear_override": True},
        )
        body = auth_client.get(
            "/api/accountability/ledger", params={"today": "2026-10-20"}
        ).json()
        assert body["total_retroactive"] == 0

    def test_an_override_set_on_the_day_itself_is_not_retroactive(
        self, auth_client: TestClient, tmp_path
    ) -> None:
        # Deciding on the morning of a travel day is planning, not revisionism.
        upsert(auth_client, "2026-10-05", SDE, minutes=20, override=30)
        stamp_override(tmp_path, "2026-10-05", SDE, "2026-10-05T08:00:00")
        body = auth_client.get(
            "/api/accountability/ledger", params={"today": "2026-10-20"}
        ).json()
        assert body["total_retroactive"] == 0


class TestBulkOverride:
    """Setting an exam fortnight one day at a time is the friction that kills use."""

    def test_applies_across_a_range(self, auth_client: TestClient) -> None:
        response = auth_client.post(
            "/api/logs/bulk-override",
            json={
                "start": "2026-10-05",
                "end": "2026-10-11",
                "category_ids": [SDE],
                "override_target_minutes": 30,
                "reason": "Exam week",
                "active_days_only": True,
            },
        )
        assert response.status_code == 200
        rows = response.json()
        # Mon-Sun minus the inactive Thursday.
        assert len(rows) == 6
        assert all(r["override_target_minutes"] == 30 for r in rows)
        assert all(r["override_reason"] == "Exam week" for r in rows)

    def test_active_days_only_skips_unscheduled_days(
        self, auth_client: TestClient
    ) -> None:
        rows = auth_client.post(
            "/api/logs/bulk-override",
            json={
                "start": "2026-10-05",
                "end": "2026-10-11",
                "category_ids": [MAINTENANCE],
                "override_target_minutes": 0,
                "active_days_only": True,
            },
        ).json()
        # Project Maintenance is Sat/Sun only.
        assert [r["log_date"] for r in rows] == ["2026-10-10", "2026-10-11"]

    def test_can_include_unscheduled_days_when_asked(
        self, auth_client: TestClient
    ) -> None:
        rows = auth_client.post(
            "/api/logs/bulk-override",
            json={
                "start": "2026-10-05",
                "end": "2026-10-11",
                "category_ids": [MAINTENANCE],
                "override_target_minutes": 15,
                "active_days_only": False,
            },
        ).json()
        assert len(rows) == 7

    def test_preserves_already_logged_minutes(self, auth_client: TestClient) -> None:
        upsert(auth_client, "2026-10-05", SDE, minutes=120)
        auth_client.post(
            "/api/logs/bulk-override",
            json={
                "start": "2026-10-05",
                "end": "2026-10-06",
                "category_ids": [SDE],
                "override_target_minutes": 30,
            },
        )
        row = next(
            r
            for r in auth_client.get("/api/logs/day/2026-10-05").json()
            if r["category_id"] == SDE
        )
        assert row["minutes_logged"] == 120
        assert row["override_target_minutes"] == 30

    def test_backwards_range_is_rejected(self, auth_client: TestClient) -> None:
        response = auth_client.post(
            "/api/logs/bulk-override",
            json={
                "start": "2026-10-11",
                "end": "2026-10-05",
                "category_ids": [SDE],
                "override_target_minutes": 30,
            },
        )
        assert response.status_code == 422

    def test_unknown_category_is_rejected(self, auth_client: TestClient) -> None:
        response = auth_client.post(
            "/api/logs/bulk-override",
            json={
                "start": "2026-10-05",
                "end": "2026-10-06",
                "category_ids": [999],
                "override_target_minutes": 30,
            },
        )
        assert response.status_code == 404

    def test_a_future_bulk_override_stays_off_the_ledger(
        self, auth_client: TestClient
    ) -> None:
        auth_client.post(
            "/api/logs/bulk-override",
            json={
                "start": "2099-01-01",
                "end": "2099-01-07",
                "category_ids": [SDE],
                "override_target_minutes": 0,
                "reason": "Exams",
            },
        )
        assert (
            auth_client.get("/api/accountability/ledger").json()["total_retroactive"] == 0
        )
