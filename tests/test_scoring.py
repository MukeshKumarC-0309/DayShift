"""Unit tests for the scoring rules.

These cover the decisions that define what a par score *means* — the ones a
future change could silently break without any test failing elsewhere.
"""

from __future__ import annotations

from datetime import date

import pytest

from scoring import (
    DayRecord,
    ScoringConfig,
    TargetRule,
    TargetSchedule,
    compute_par,
    consecutive_days_below,
    daily_percent,
    effective_target,
    longest_streak_at_or_above,
    mean,
    moving_average,
    par_window_bounds,
    parse_day_codes,
    status_for,
    stdev,
    trend_for,
)

# October 2026: Thu 1, Fri 2, Sat 3, Sun 4, Mon 5, Tue 6, Wed 7, Thu 8, Fri 9,
# Sat 10, Sun 11. Thursday is inactive for the weekday schedule below.
WEEKDAYS = parse_day_codes("MON,TUE,WED,FRI,SAT,SUN")
WEEKENDS = parse_day_codes("SAT,SUN")

CONFIG = ScoringConfig(tracking_start=date(2026, 10, 1))


def schedule(target: int = 180, days=WEEKDAYS, start=date(2026, 10, 1)) -> TargetSchedule:
    return TargetSchedule([TargetRule(start, target, days)])


def records(**kwargs: int) -> dict[str, DayRecord]:
    """Build records from `d2026_10_05=150` style keyword arguments."""
    out: dict[str, DayRecord] = {}
    for key, minutes in kwargs.items():
        iso = key[1:].replace("_", "-")
        out[iso] = DayRecord(minutes=minutes)
    return out


class TestEffectiveTarget:
    def test_active_weekday_uses_the_scheduled_target(self) -> None:
        assert effective_target(schedule(), date(2026, 10, 2), None, CONFIG) == (
            180,
            True,
        )

    def test_inactive_weekday_does_not_count(self) -> None:
        target, counts = effective_target(schedule(), date(2026, 10, 1), None, CONFIG)
        assert (target, counts) == (0, False)

    def test_override_activates_an_inactive_day(self) -> None:
        record = DayRecord(minutes=60, override_target=90)
        assert effective_target(schedule(), date(2026, 10, 1), record, CONFIG) == (
            90,
            True,
        )

    def test_zero_override_opts_an_active_day_out_of_its_target(self) -> None:
        record = DayRecord(minutes=0, override_target=0)
        assert effective_target(schedule(), date(2026, 10, 2), record, CONFIG) == (
            0,
            True,
        )

    def test_days_before_tracking_start_never_count(self) -> None:
        assert effective_target(schedule(), date(2026, 9, 30), None, CONFIG) == (0, False)

    def test_override_cannot_resurrect_an_untracked_day(self) -> None:
        record = DayRecord(minutes=120, override_target=120)
        _, counts = effective_target(schedule(), date(2026, 9, 30), record, CONFIG)
        assert counts is False

    def test_day_before_the_category_existed_does_not_count(self) -> None:
        later = schedule(start=date(2026, 10, 5))
        _, counts = effective_target(later, date(2026, 10, 2), None, CONFIG)
        assert counts is False


class TestEffectiveDatedTargets:
    """Batch 0: changing a target must not rewrite already-scored days."""

    def test_resolves_the_rule_in_force_on_the_day(self) -> None:
        history = TargetSchedule(
            [
                TargetRule(date(2026, 10, 1), 180, WEEKDAYS),
                TargetRule(date(2026, 10, 20), 120, WEEKDAYS),
            ]
        )
        assert history.for_date(date(2026, 10, 3)).daily_target_minutes == 180
        assert history.for_date(date(2026, 10, 19)).daily_target_minutes == 180
        assert history.for_date(date(2026, 10, 20)).daily_target_minutes == 120
        assert history.for_date(date(2026, 11, 1)).daily_target_minutes == 120

    def test_lowering_a_target_leaves_past_par_untouched(self) -> None:
        logged = records(d2026_10_02=150, d2026_10_03=150, d2026_10_04=150)
        before = compute_par(
            schedule(), logged, date(2026, 10, 2), date(2026, 10, 4), CONFIG
        )
        after_change = TargetSchedule(
            [
                TargetRule(date(2026, 10, 1), 180, WEEKDAYS),
                TargetRule(date(2026, 10, 20), 120, WEEKDAYS),
            ]
        )
        after = compute_par(
            after_change, logged, date(2026, 10, 2), date(2026, 10, 4), CONFIG
        )
        assert before.par_percent == after.par_percent
        assert after.target_total == 540

    def test_a_schedule_change_applies_from_its_date_onward(self) -> None:
        # Weekend-only until Oct 5, then every weekday.
        history = TargetSchedule(
            [
                TargetRule(date(2026, 10, 1), 20, WEEKENDS),
                TargetRule(date(2026, 10, 5), 20, WEEKDAYS),
            ]
        )
        _, before = effective_target(history, date(2026, 10, 2), None, CONFIG)
        _, after = effective_target(history, date(2026, 10, 6), None, CONFIG)
        assert before is False  # Friday Oct 2 was not yet scheduled
        assert after is True  # Tuesday Oct 6 is

    def test_no_targets_at_all_means_nothing_counts(self) -> None:
        empty = TargetSchedule([])
        assert effective_target(empty, date(2026, 10, 2), None, CONFIG) == (0, False)


class TestDailyPercent:
    def test_ordinary(self) -> None:
        assert daily_percent(90, 180) == 50.0

    def test_zero_target_counts_as_fully_met(self) -> None:
        assert daily_percent(0, 0) == 100.0

    def test_overshoot_is_not_capped(self) -> None:
        assert daily_percent(360, 180) == 200.0


class TestParWindow:
    def test_window_ends_yesterday(self) -> None:
        start, end = par_window_bounds(date(2026, 10, 10), CONFIG)
        assert (start, end) == (date(2026, 10, 3), date(2026, 10, 9))

    def test_previous_window_is_adjacent(self) -> None:
        start, end = par_window_bounds(date(2026, 10, 10), CONFIG, offset_windows=1)
        assert (start, end) == (date(2026, 9, 26), date(2026, 10, 2))

    def test_including_today_shifts_the_window(self) -> None:
        config = ScoringConfig(tracking_start=date(2026, 10, 1), par_includes_today=True)
        _, end = par_window_bounds(date(2026, 10, 10), config)
        assert end == date(2026, 10, 10)

    def test_window_length_is_configurable(self) -> None:
        config = ScoringConfig(tracking_start=date(2026, 10, 1), par_window_days=14)
        start, end = par_window_bounds(date(2026, 10, 20), config)
        assert (end - start).days == 13


class TestComputePar:
    def test_excludes_pre_tracking_days_from_both_sides(self) -> None:
        logged = records(d2026_10_02=180, d2026_10_03=180, d2026_10_04=90)
        result = compute_par(
            schedule(), logged, date(2026, 9, 28), date(2026, 10, 4), CONFIG
        )
        assert result.days_counted == 3
        assert result.target_total == 540
        assert result.minutes_total == 450
        assert result.par_percent == pytest.approx(83.33, abs=0.01)

    def test_missing_record_counts_as_zero_minutes(self) -> None:
        result = compute_par(
            schedule(),
            records(d2026_10_02=180),
            date(2026, 10, 2),
            date(2026, 10, 3),
            CONFIG,
        )
        assert (result.days_counted, result.minutes_total, result.target_total) == (
            2,
            180,
            360,
        )
        assert result.par_percent == 50.0

    def test_weekend_only_category_ignores_weekdays(self) -> None:
        weekend = schedule(target=20, days=WEEKENDS)
        result = compute_par(
            weekend,
            records(d2026_10_03=20, d2026_10_04=20),
            date(2026, 10, 1),
            date(2026, 10, 7),
            CONFIG,
        )
        assert result.days_counted == 2
        assert result.target_total == 40
        assert result.par_percent == 100.0

    def test_no_counted_days_returns_none_not_zero(self) -> None:
        result = compute_par(schedule(), {}, date(2026, 9, 1), date(2026, 9, 7), CONFIG)
        assert result.par_percent is None
        assert result.days_counted == 0

    def test_all_targets_overridden_to_zero_is_fully_met(self) -> None:
        logged = {"2026-10-02": DayRecord(minutes=0, override_target=0)}
        result = compute_par(
            schedule(), logged, date(2026, 10, 2), date(2026, 10, 2), CONFIG
        )
        assert (result.par_percent, result.target_total) == (100.0, 0)


class TestConsecutiveDaysBelow:
    def test_counts_back_over_failing_days(self) -> None:
        logged = records(d2026_10_05=30, d2026_10_06=30, d2026_10_07=30, d2026_10_04=180)
        assert consecutive_days_below(schedule(), logged, date(2026, 10, 8), CONFIG) == 3

    def test_stops_at_a_passing_day(self) -> None:
        logged = records(d2026_10_07=30, d2026_10_06=180, d2026_10_05=30)
        assert consecutive_days_below(schedule(), logged, date(2026, 10, 8), CONFIG) == 1

    def test_steps_over_an_inactive_day(self) -> None:
        """Thursday is skipped, not treated as a break."""
        logged = records(d2026_10_07=30, d2026_10_09=30, d2026_10_06=180)
        assert consecutive_days_below(schedule(), logged, date(2026, 10, 10), CONFIG) == 2

    def test_friday_can_reach_a_streak_despite_thursday(self) -> None:
        logged = records(d2026_10_05=30, d2026_10_06=30, d2026_10_07=30, d2026_10_04=180)
        assert consecutive_days_below(schedule(), logged, date(2026, 10, 9), CONFIG) == 3

    def test_weekend_category_spans_whole_weekdays(self) -> None:
        weekend = schedule(target=20, days=WEEKENDS)
        logged = records(d2026_10_03=2, d2026_10_04=2, d2026_10_10=2)
        assert consecutive_days_below(weekend, logged, date(2026, 10, 11), CONFIG) == 3

    def test_stops_at_tracking_start(self) -> None:
        logged = {"2026-10-01": DayRecord(minutes=0, override_target=10)}
        assert consecutive_days_below(schedule(), logged, date(2026, 10, 2), CONFIG) == 1

    def test_threshold_is_configurable(self) -> None:
        lenient = ScoringConfig(tracking_start=date(2026, 10, 1), warning_threshold=10.0)
        logged = records(d2026_10_07=30)  # 16.7% of 180
        assert consecutive_days_below(schedule(), logged, date(2026, 10, 8), lenient) == 0


class TestStatusFor:
    @pytest.mark.parametrize(
        ("par", "streak", "expected"),
        [
            (95.0, 0, "healthy"),
            (85.0, 1, "healthy"),
            (85.0, 2, "warning"),
            (85.0, 3, "critical"),
            (45.0, 0, "critical"),
            (None, 0, "none"),
        ],
    )
    def test_thresholds(self, par: float | None, streak: int, expected: str) -> None:
        assert status_for(par, streak, CONFIG) == expected

    def test_thresholds_follow_the_config(self) -> None:
        strict = ScoringConfig(tracking_start=date(2026, 10, 1), warning_days=1)
        assert status_for(85.0, 1, strict) == "warning"


class TestTrendFor:
    @pytest.mark.parametrize(
        ("current", "previous", "expected"),
        [
            (80.0, 70.0, "up"),
            (70.0, 80.0, "down"),
            (80.0, 80.0, "flat"),
            (80.0, None, "none"),
            (None, 80.0, "none"),
        ],
    )
    def test_direction(self, current, previous, expected) -> None:
        assert trend_for(current, previous) == expected


class TestAnalyticsHelpers:
    """Batch 4 primitives."""

    def test_mean_of_empty_is_zero(self) -> None:
        assert mean([]) == 0.0

    def test_stdev_needs_two_values(self) -> None:
        assert stdev([5.0]) == 0.0

    def test_stdev_of_identical_values_is_zero(self) -> None:
        assert stdev([100.0, 100.0, 100.0]) == 0.0

    def test_stdev_detects_spread(self) -> None:
        steady = stdev([100.0, 100.0, 100.0, 100.0])
        spiky = stdev([0.0, 0.0, 0.0, 400.0])
        assert spiky > steady

    def test_moving_average_is_none_until_the_window_fills(self) -> None:
        assert moving_average([1.0, 2.0, 3.0], 3) == [None, None, 2.0]

    def test_moving_average_skips_none_days(self) -> None:
        # A rest day must not drag the average toward zero.
        assert moving_average([100.0, None, 100.0], 2) == [None, None, 100.0]

    def test_longest_streak_counts_the_best_run(self) -> None:
        logged = records(
            d2026_10_02=180,
            d2026_10_03=180,
            d2026_10_04=0,
            d2026_10_05=180,
            d2026_10_06=180,
            d2026_10_07=180,
        )
        assert (
            longest_streak_at_or_above(
                schedule(), logged, date(2026, 10, 2), date(2026, 10, 7), CONFIG
            )
            == 3
        )
