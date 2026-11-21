from datetime import UTC, datetime

from imsc.report import ActivityItem, render_monthly_activity_summary


def myt(year: int, month: int, day: int, hour: int = 9) -> int:
    naive = datetime(year, month, day, hour)
    utc_value = naive.replace(tzinfo=UTC)
    # Kuala Lumpur is UTC+8; subtract it to express the local wall clock as UTC.
    return int((utc_value.timestamp() - 8 * 3600) * 1000)


def test_renders_sorted_lines_empty_day_headings_warnings_and_separators():
    assert render_monthly_activity_summary(
        [
            ActivityItem(myt(2026, 9, 8), 1, ()),
            ActivityItem(myt(2026, 9, 9), 2, ("+8801303077021", "+601162168427")),
        ],
        ["09/09/2026: participant identity unavailable."],
    ) == (
        "*08/09/2026*\n\n*09/09/2026*\n+601162168427 - 2\n+8801303077021 - 2\n\n\n"
        "Warnings:\n- 09/09/2026: participant identity unavailable.\n"
    )


def test_an_empty_summary_is_empty():
    assert render_monthly_activity_summary([], []) == ""
