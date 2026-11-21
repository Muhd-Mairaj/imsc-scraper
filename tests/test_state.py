from pathlib import Path

from imsc.state import (
    EMPTY_STATE,
    WeeklyState,
    load_weekly_state,
    save_weekly_state,
    should_send_alert,
    should_send_month_end,
    should_send_report,
)


def test_missing_state_reads_as_empty(tmp_path: Path):
    assert load_weekly_state(tmp_path / "missing.json") == EMPTY_STATE


def test_malformed_state_reads_as_empty(tmp_path: Path):
    path = tmp_path / "state.json"
    path.write_text("not json at all", encoding="utf-8")
    assert load_weekly_state(path) == EMPTY_STATE


def test_state_survives_a_save_and_load_round_trip(tmp_path: Path):
    path = tmp_path / "state.json"
    save_weekly_state(
        WeeklyState(
            last_report_window_end=1_789_000_000_000,
            last_alert_window_end=None,
            last_month_end_window_end=None,
        ),
        path,
    )
    assert load_weekly_state(path) == WeeklyState(
        last_report_window_end=1_789_000_000_000,
        last_alert_window_end=None,
        last_month_end_window_end=None,
    )


def test_reports_are_sent_when_the_window_has_not_been_recorded():
    assert should_send_report(EMPTY_STATE, 1_789_000_000_000)
    assert should_send_report(
        WeeklyState(last_report_window_end=1_788_000_000_000), 1_789_000_000_000
    )


def test_reports_are_skipped_when_the_window_was_already_recorded():
    assert not should_send_report(
        WeeklyState(last_report_window_end=1_789_000_000_000), 1_789_000_000_000
    )


def test_reports_are_skipped_for_a_window_older_than_the_last_one_sent():
    assert not should_send_report(
        WeeklyState(last_report_window_end=1_790_000_000_000), 1_789_000_000_000
    )


def test_alerts_are_tracked_independently_of_reports():
    state = WeeklyState(
        last_report_window_end=1_789_000_000_000,
        last_alert_window_end=1_789_000_000_000,
    )
    assert not should_send_report(state, 1_789_000_000_000)
    assert not should_send_alert(state, 1_789_000_000_000)
    assert should_send_alert(
        WeeklyState(
            last_report_window_end=state.last_report_window_end,
            last_alert_window_end=None,
        ),
        1_789_000_000_000,
    )


def test_month_end_is_tracked_independently_of_the_weekly_report():
    assert should_send_month_end(EMPTY_STATE, 1_790_000_000_000)
    assert not should_send_month_end(
        WeeklyState(last_month_end_window_end=1_790_000_000_000), 1_790_000_000_000
    )
    assert should_send_month_end(
        WeeklyState(last_report_window_end=1_790_000_000_000), 1_790_000_000_000
    )
