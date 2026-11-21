from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

from .config import weekly_state_path


@dataclass(frozen=True)
class WeeklyState:
    last_report_window_end: int | None = None
    last_alert_window_end: int | None = None
    last_month_end_window_end: int | None = None


EMPTY_STATE = WeeklyState()


def _valid_optional_int(value: object) -> bool:
    return value is None or (isinstance(value, int) and not isinstance(value, bool))


def load_weekly_state(path: Path | None = None) -> WeeklyState:
    """Missing or malformed state is empty state, never an error."""
    state_path = path or weekly_state_path()
    try:
        raw = state_path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return EMPTY_STATE
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return EMPTY_STATE
    if not isinstance(parsed, dict):
        return EMPTY_STATE
    fields = (
        parsed.get("lastReportWindowEnd"),
        parsed.get("lastAlertWindowEnd"),
        parsed.get("lastMonthEndWindowEnd"),
    )
    if any(not _valid_optional_int(value) for value in fields):
        return EMPTY_STATE
    return WeeklyState(
        last_report_window_end=fields[0],
        last_alert_window_end=fields[1],
        last_month_end_window_end=fields[2],
    )


def save_weekly_state(state: WeeklyState, path: Path | None = None) -> None:
    state_path = path or weekly_state_path()
    state_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    payload: dict[str, int] = {}
    if state.last_report_window_end is not None:
        payload["lastReportWindowEnd"] = state.last_report_window_end
    if state.last_alert_window_end is not None:
        payload["lastAlertWindowEnd"] = state.last_alert_window_end
    if state.last_month_end_window_end is not None:
        payload["lastMonthEndWindowEnd"] = state.last_month_end_window_end
    temporary_path = state_path.with_name(f"{state_path.name}.{os.getpid()}.tmp")
    temporary_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    temporary_path.chmod(0o600)
    temporary_path.replace(state_path)


def should_send_report(state: WeeklyState, window_end_ms: int) -> bool:
    return state.last_report_window_end is None or state.last_report_window_end < window_end_ms


def should_send_alert(state: WeeklyState, window_end_ms: int) -> bool:
    return state.last_alert_window_end != window_end_ms


def should_send_month_end(state: WeeklyState, window_end_ms: int) -> bool:
    return state.last_month_end_window_end != window_end_ms
