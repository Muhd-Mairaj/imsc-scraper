from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

WEEKLY_TIME_ZONE = "Asia/Kuala_Lumpur"
TZ = ZoneInfo(WEEKLY_TIME_ZONE)
DAY_MS = 86_400_000
SATURDAY_ISO = 6


@dataclass(frozen=True)
class WeeklyWindow:
    start_ms: int
    end_ms: int


def _as_local(now: datetime) -> datetime:
    if now.tzinfo is None:
        now = now.replace(tzinfo=UTC)
    return now.astimezone(TZ)


def _midnight(value: datetime) -> datetime:
    return value.replace(hour=0, minute=0, second=0, microsecond=0)


def _ms(value: datetime) -> int:
    return int(value.timestamp() * 1000)


def compute_weekly_window(now: datetime) -> WeeklyWindow:
    """Seven complete local days ending at the most recent Saturday 00:00.

    Anchored to that boundary, not to ``now``, so a catch-up run reports the
    same week it would have on the Saturday.
    """
    local = _as_local(now)
    days_since_saturday = (local.isoweekday() - SATURDAY_ISO + 7) % 7
    end_ms = _ms(_midnight(local - timedelta(days=days_since_saturday)))
    return WeeklyWindow(start_ms=end_ms - 7 * DAY_MS, end_ms=end_ms)


def compute_month_end_window(now: datetime, last_report_window_end: int | None) -> WeeklyWindow:
    """The days since the last report, ending at the current local month start.

    The start is capped at the previous month start, so a long gap between
    reports still yields at most one month.
    """
    local = _as_local(now)
    month_start = _midnight(local.replace(day=1))
    previous_month_start = _midnight((month_start - timedelta(days=1)).replace(day=1))
    previous_month_start_ms = _ms(previous_month_start)
    start_ms = max(
        last_report_window_end if last_report_window_end is not None else previous_month_start_ms,
        previous_month_start_ms,
    )
    return WeeklyWindow(start_ms=start_ms, end_ms=_ms(month_start))


def format_date(timestamp_ms: int) -> str:
    return datetime.fromtimestamp(timestamp_ms / 1000, tz=TZ).strftime("%d/%m/%Y")


def format_window_range(window: WeeklyWindow) -> str:
    """Both endpoint days are inclusive, e.g. ``12/09/2026 – 18/09/2026``."""
    return f"{format_date(window.start_ms)} – {format_date(window.end_ms - 1)}"


def parse_report_week(value: str) -> datetime:
    try:
        return datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=TZ)
    except ValueError as error:
        raise ValueError(f'Invalid --week date "{value}"; use YYYY-MM-DD.') from error
