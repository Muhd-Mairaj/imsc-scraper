from datetime import datetime

from imsc.schedule import compute_weekly_window
from imsc.weekly import render_failure_alert, render_weekly_report

WINDOW = compute_weekly_window(datetime.fromisoformat("2026-09-18T22:00:00+00:00"))


def test_wraps_a_report_body_with_the_marker_and_signature():
    assert render_weekly_report(WINDOW, "*15/09/2026*\n+601162168427 - 2\n\n") == (
        "[AUTO MESSAGE]\n*Weekly engagement report*\n12/09/2026 – 18/09/2026\n\n"
        "*15/09/2026*\n+601162168427 - 2\n\n_~ Mairaj's Bot_\n"
    )


def test_a_blank_body_becomes_the_empty_week_notice():
    assert render_weekly_report(WINDOW, "") == (
        "[AUTO MESSAGE]\n*Weekly engagement report*\n12/09/2026 – 18/09/2026\n\n"
        "No engagement recorded this week.\n\n_~ Mairaj's Bot_\n"
    )


def test_a_whitespace_only_body_is_also_empty():
    assert render_weekly_report(WINDOW, "\n\n  \n") == (
        "[AUTO MESSAGE]\n*Weekly engagement report*\n12/09/2026 – 18/09/2026\n\n"
        "No engagement recorded this week.\n\n_~ Mairaj's Bot_\n"
    )


def test_renders_a_failure_alert():
    assert render_failure_alert(WINDOW, "WhatsApp session is not connected.") == (
        "[AUTO MESSAGE]\n*Weekly report failed*\n12/09/2026 – 18/09/2026\n\n"
        "WhatsApp session is not connected.\n\n_~ Mairaj's Bot_\n"
    )


def test_every_rendered_message_carries_both_markers():
    for message in (
        render_weekly_report(WINDOW, "body\n"),
        render_weekly_report(WINDOW, ""),
        render_failure_alert(WINDOW, "boom"),
    ):
        assert message.startswith("[AUTO MESSAGE]\n")
        assert message.endswith("_~ Mairaj's Bot_\n")
