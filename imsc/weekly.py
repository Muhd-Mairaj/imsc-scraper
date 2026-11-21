from __future__ import annotations

from .schedule import WeeklyWindow, format_window_range

AUTO_MESSAGE_MARKER = "[AUTO MESSAGE]"
BOT_SIGNATURE = "_~ Mairaj's Bot_"
EMPTY_WEEK_NOTICE = "No engagement recorded this week."


def _envelope(heading: str, window: WeeklyWindow, body: str) -> str:
    return (
        f"{AUTO_MESSAGE_MARKER}\n*{heading}*\n{format_window_range(window)}\n\n"
        f"{body}\n\n{BOT_SIGNATURE}\n"
    )


def render_weekly_report(window: WeeklyWindow, body: str) -> str:
    """A blank body renders the empty-week notice."""
    trimmed = body.strip()
    return _envelope(
        "Weekly engagement report",
        window,
        EMPTY_WEEK_NOTICE if not trimmed else trimmed,
    )


def render_failure_alert(window: WeeklyWindow, error_summary: str) -> str:
    return _envelope("Weekly report failed", window, error_summary.strip())
