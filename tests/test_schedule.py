from datetime import UTC, datetime

from imsc.schedule import (
    compute_month_end_window,
    compute_weekly_window,
    format_window_range,
)


def utc(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def iso(timestamp_ms: int) -> str:
    return datetime.fromtimestamp(timestamp_ms / 1000, tz=UTC).isoformat().replace("+00:00", "Z")


def test_an_on_time_saturday_run_covers_the_seven_days_ending_that_midnight():
    window = compute_weekly_window(utc("2026-09-18T22:00:00.000Z"))
    assert iso(window.start_ms) == "2026-09-11T16:00:00Z"
    assert iso(window.end_ms) == "2026-09-18T16:00:00Z"


def test_a_catch_up_run_on_monday_computes_the_same_window():
    window = compute_weekly_window(utc("2026-09-21T02:00:00.000Z"))
    assert iso(window.start_ms) == "2026-09-11T16:00:00Z"
    assert iso(window.end_ms) == "2026-09-18T16:00:00Z"


def test_a_run_on_the_following_friday_still_reports_the_most_recent_week():
    window = compute_weekly_window(utc("2026-09-25T04:00:00.000Z"))
    assert iso(window.start_ms) == "2026-09-11T16:00:00Z"
    assert iso(window.end_ms) == "2026-09-18T16:00:00Z"


def test_a_run_exactly_at_saturday_midnight_ends_its_window_there():
    window = compute_weekly_window(utc("2026-09-18T16:00:00.000Z"))
    assert iso(window.end_ms) == "2026-09-18T16:00:00Z"
    assert iso(window.start_ms) == "2026-09-11T16:00:00Z"


def test_one_millisecond_before_saturday_reports_the_previous_week():
    window = compute_weekly_window(utc("2026-09-18T15:59:59.999Z"))
    assert iso(window.end_ms) == "2026-09-11T16:00:00Z"
    assert iso(window.start_ms) == "2026-09-04T16:00:00Z"


def test_the_window_is_exactly_seven_days_long():
    window = compute_weekly_window(utc("2026-09-18T22:00:00.000Z"))
    assert window.end_ms - window.start_ms == 7 * 86_400_000


def test_format_window_range_shows_inclusive_first_and_last_day():
    window = compute_weekly_window(utc("2026-09-18T22:00:00.000Z"))
    assert format_window_range(window) == "12/09/2026 – 18/09/2026"


def test_month_end_window_runs_from_the_last_report_to_the_month_start():
    window = compute_month_end_window(
        utc("2026-09-30T22:00:00.000Z"),
        int(utc("2026-09-28T16:00:00.000Z").timestamp() * 1000),
    )
    assert iso(window.start_ms) == "2026-09-28T16:00:00Z"
    assert iso(window.end_ms) == "2026-09-30T16:00:00Z"
    assert format_window_range(window) == "29/09/2026 – 30/09/2026"


def test_month_end_window_is_capped_at_the_previous_month_start():
    window = compute_month_end_window(
        utc("2026-09-30T22:00:00.000Z"),
        int(utc("2026-01-01T00:00:00.000Z").timestamp() * 1000),
    )
    assert iso(window.start_ms) == "2026-08-31T16:00:00Z"
    assert iso(window.end_ms) == "2026-09-30T16:00:00Z"


def test_month_end_window_falls_back_when_there_is_no_last_report():
    window = compute_month_end_window(utc("2026-09-30T22:00:00.000Z"), None)
    assert iso(window.start_ms) == "2026-08-31T16:00:00Z"
    assert iso(window.end_ms) == "2026-09-30T16:00:00Z"


def test_month_end_with_nothing_since_the_last_report_is_empty():
    window = compute_month_end_window(
        utc("2026-09-30T22:00:00.000Z"),
        int(utc("2026-09-30T16:00:00.000Z").timestamp() * 1000),
    )
    assert window.start_ms == window.end_ms
