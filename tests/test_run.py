from datetime import UTC, datetime

import pytest

from imsc.report import ActivityItem
from imsc.run import (
    Engagement,
    ReportDependencies,
    run_month_end_report,
    run_weekly_report,
)
from imsc.state import WeeklyState

NOW = datetime(2026, 9, 18, 22, 0, tzinfo=UTC)
WINDOW_END = int(datetime(2026, 9, 18, 16, 0, tzinfo=UTC).timestamp() * 1000)
EMPTY_STATE = WeeklyState()


def item(display: str = "+601162168427") -> ActivityItem:
    return ActivityItem(
        timestamp_ms=int(datetime(2026, 9, 15, 2, 0, tzinfo=UTC).timestamp() * 1000),
        activity=2,
        participant_displays=(display,),
    )


def harness(**overrides):
    sent: list[tuple[str, str]] = []
    saved: list[WeeklyState] = []
    logs: list[str] = []
    dependencies = ReportDependencies(
        now=NOW,
        collect=lambda _: Engagement((item(),), ()),
        send_message=lambda chat_id, content: sent.append((chat_id, content)),
        recipient_chat_id="60123456789@c.us",
        self_chat_id="60199999999@c.us",
        force=False,
        dry_run=False,
        state=EMPTY_STATE,
        save_state=lambda state: saved.append(state),
        log=logs.append,
    )
    for key, value in overrides.items():
        setattr(dependencies, key, value)
    return dependencies, sent, saved, logs


def test_sends_the_report_to_the_recipient_and_records_the_window():
    dependencies, sent, saved, _ = harness()
    outcome = run_weekly_report(dependencies)
    assert outcome.status == "sent"
    assert outcome.empty_week is False
    assert len(sent) == 1
    assert sent[0][0] == "60123456789@c.us"
    assert sent[0][1].startswith("[AUTO MESSAGE]\n")
    assert saved[-1].last_report_window_end == WINDOW_END


def test_skips_without_collecting_when_the_window_was_already_sent():
    collected = 0

    def collect(_):
        nonlocal collected
        collected += 1
        return Engagement((), ())

    dependencies, sent, _, _ = harness(
        state=WeeklyState(last_report_window_end=WINDOW_END), collect=collect
    )
    outcome = run_weekly_report(dependencies)
    assert outcome.status == "skipped"
    assert collected == 0
    assert sent == []


def test_force_sends_again_when_the_window_was_already_sent():
    dependencies, sent, saved, _ = harness(
        force=True, state=WeeklyState(last_report_window_end=WINDOW_END)
    )
    outcome = run_weekly_report(dependencies)
    assert outcome.status == "sent"
    assert len(sent) == 1
    assert saved[-1].last_report_window_end == WINDOW_END


def test_a_dry_run_prints_without_sending_or_saving():
    dependencies, sent, saved, logs = harness(dry_run=True)
    outcome = run_weekly_report(dependencies)
    assert outcome.status == "dry-run"
    assert sent == []
    assert saved == []
    assert any("[AUTO MESSAGE]" in line for line in logs)


def test_a_dry_run_ignores_an_already_sent_window():
    dependencies, sent, saved, _ = harness(
        dry_run=True, state=WeeklyState(last_report_window_end=WINDOW_END)
    )
    outcome = run_weekly_report(dependencies)
    assert outcome.status == "dry-run"
    assert sent == []
    assert saved == []


def test_an_empty_week_notifies_both_the_recipient_and_the_operator():
    dependencies, sent, _, _ = harness(collect=lambda _: Engagement((), ()))
    outcome = run_weekly_report(dependencies)
    assert outcome.status == "sent"
    assert outcome.empty_week is True
    assert [entry[0] for entry in sent] == [
        "60123456789@c.us",
        "60199999999@c.us",
    ]


def test_warnings_do_not_hide_an_empty_week_from_the_operator():
    dependencies, sent, _, _ = harness(
        collect=lambda _: Engagement(
            (), ("History may not reach the start of the reporting week.",)
        )
    )
    outcome = run_weekly_report(dependencies)
    assert outcome.empty_week is True
    assert [entry[0] for entry in sent] == [
        "60123456789@c.us",
        "60199999999@c.us",
    ]
    assert "No engagement recorded this week." in sent[0][1]


def test_collect_receives_the_same_window_used_for_the_report():
    received = {}

    def collect(window):
        received["window"] = window
        return Engagement((), ())

    dependencies, _, _, _ = harness(collect=collect)
    run_weekly_report(dependencies)
    assert received["window"].end_ms == WINDOW_END


def test_a_collection_failure_alerts_once_and_rethrows():
    def collect(_):
        raise RuntimeError("history unavailable")

    dependencies, sent, saved, _ = harness(collect=collect)
    with pytest.raises(RuntimeError, match="history unavailable"):
        run_weekly_report(dependencies)
    assert len(sent) == 1
    assert sent[0][0] == "60199999999@c.us"
    assert "history unavailable" in sent[0][1]
    assert saved[-1].last_alert_window_end == WINDOW_END


def test_a_second_failure_in_the_same_window_does_not_alert_again():
    def collect(_):
        raise RuntimeError("history unavailable")

    dependencies, sent, _, _ = harness(
        collect=collect,
        state=WeeklyState(last_alert_window_end=WINDOW_END),
    )
    with pytest.raises(RuntimeError):
        run_weekly_report(dependencies)
    assert sent == []


def test_force_alerts_again_when_the_window_already_alerted():
    def collect(_):
        raise RuntimeError("history unavailable")

    dependencies, sent, _, _ = harness(
        collect=collect,
        force=True,
        state=WeeklyState(last_alert_window_end=WINDOW_END),
    )
    with pytest.raises(RuntimeError):
        run_weekly_report(dependencies)
    assert len(sent) == 1
    assert sent[0][0] == "60199999999@c.us"


def test_a_failed_alert_never_breaks_the_run():
    def collect(_):
        raise RuntimeError("history unavailable")

    dependencies, _, _, logs = harness(collect=collect, self_chat_id=None)
    with pytest.raises(RuntimeError):
        run_weekly_report(dependencies)
    assert any("alert" in line for line in logs)


def test_an_unsupported_self_send_is_swallowed():
    def send(chat_id, _content):
        if chat_id == "60199999999@c.us":
            raise RuntimeError("cannot send to yourself")

    def collect(_):
        raise RuntimeError("history unavailable")

    dependencies, _, _, logs = harness(collect=collect, send_message=send)
    with pytest.raises(RuntimeError):
        run_weekly_report(dependencies)
    assert any("cannot send to yourself" in line for line in logs)


MONTH_END_NOW = datetime(2026, 9, 30, 22, 0, tzinfo=UTC)
LAST_WEEKLY_END = int(datetime(2026, 9, 28, 16, 0, tzinfo=UTC).timestamp() * 1000)
MONTH_START = int(datetime(2026, 9, 30, 16, 0, tzinfo=UTC).timestamp() * 1000)


def month_end_state(**overrides) -> WeeklyState:
    values = {
        "last_report_window_end": LAST_WEEKLY_END,
        "last_alert_window_end": None,
        "last_month_end_window_end": None,
    }
    values.update(overrides)
    return WeeklyState(**values)


def test_month_end_sends_the_days_since_the_last_report():
    dependencies, sent, saved, _ = harness(now=MONTH_END_NOW, state=month_end_state())
    outcome = run_month_end_report(dependencies)
    assert outcome.status == "sent"
    assert len(sent) == 1
    assert sent[0][0] == "60123456789@c.us"
    assert saved[-1].last_month_end_window_end == MONTH_START
    assert saved[-1].last_report_window_end == LAST_WEEKLY_END


def test_month_end_window_starts_at_the_last_report_and_ends_at_month_start():
    received = {}

    def collect(window):
        received["window"] = window
        return Engagement((), ())

    dependencies, _, _, _ = harness(now=MONTH_END_NOW, state=month_end_state(), collect=collect)
    run_month_end_report(dependencies)
    assert received["window"].start_ms == LAST_WEEKLY_END
    assert received["window"].end_ms == MONTH_START


def test_month_end_skips_when_nothing_happened_since_the_last_report():
    dependencies, sent, _, logs = harness(
        now=MONTH_END_NOW, state=month_end_state(last_report_window_end=MONTH_START)
    )
    outcome = run_month_end_report(dependencies)
    assert outcome.status == "skipped"
    assert sent == []
    assert any("No complete days" in line for line in logs)


def test_month_end_skips_a_month_that_was_already_recorded():
    def collect(_):
        raise RuntimeError("should not collect")

    dependencies, sent, _, _ = harness(
        now=MONTH_END_NOW,
        state=month_end_state(last_month_end_window_end=MONTH_START),
        collect=collect,
    )
    outcome = run_month_end_report(dependencies)
    assert outcome.status == "skipped"
    assert sent == []


def test_force_re_sends_an_already_recorded_month_end():
    dependencies, sent, _, _ = harness(
        now=MONTH_END_NOW,
        state=month_end_state(last_month_end_window_end=MONTH_START),
        force=True,
    )
    outcome = run_month_end_report(dependencies)
    assert outcome.status == "sent"
    assert len(sent) == 1
