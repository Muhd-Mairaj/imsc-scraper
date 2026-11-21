from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime

from .report import ActivityItem, render_monthly_activity_summary
from .schedule import (
    WEEKLY_TIME_ZONE,
    WeeklyWindow,
    compute_month_end_window,
    compute_weekly_window,
    format_window_range,
)
from .state import (
    WeeklyState,
    should_send_alert,
    should_send_month_end,
    should_send_report,
)
from .utils import error_message
from .weekly import render_failure_alert, render_weekly_report


@dataclass(frozen=True)
class Engagement:
    items: tuple[ActivityItem, ...]
    warnings: tuple[str, ...]


@dataclass
class ReportDependencies:
    now: datetime
    collect: Callable[[WeeklyWindow], Engagement]
    send_message: Callable[[str, str], None]
    recipient_chat_id: str
    self_chat_id: str | None
    force: bool
    dry_run: bool
    state: WeeklyState
    save_state: Callable[[WeeklyState], None]
    log: Callable[[str], None]


@dataclass(frozen=True)
class WeeklyOutcome:
    status: str
    empty_week: bool


@dataclass(frozen=True)
class ReportPlan:
    label: str
    window: WeeklyWindow
    needs_sending: Callable[[WeeklyState, int], bool]
    record_sent: Callable[[WeeklyState, int], WeeklyState]


def _alert_best_effort(
    dependencies: ReportDependencies, window: WeeklyWindow, error: Exception
) -> None:
    if dependencies.self_chat_id is None:
        dependencies.log("No self chat id is available; skipping the failure alert.")
        return
    if not dependencies.force and not should_send_alert(dependencies.state, window.end_ms):
        dependencies.log("A failure alert was already sent for this window; skipping.")
        return
    try:
        dependencies.send_message(
            dependencies.self_chat_id,
            render_failure_alert(window, error_message(error)),
        )
        dependencies.save_state(
            WeeklyState(
                last_report_window_end=dependencies.state.last_report_window_end,
                last_alert_window_end=window.end_ms,
                last_month_end_window_end=dependencies.state.last_month_end_window_end,
            )
        )
    except Exception as alert_error:
        dependencies.log(f"The failure alert could not be sent: {error_message(alert_error)}")


def _run_report(dependencies: ReportDependencies, plan: ReportPlan) -> WeeklyOutcome:
    window = plan.window
    dependencies.log(
        f"{plan.label} window: {format_window_range(window)} "
        f"({WEEKLY_TIME_ZONE}), ending {window.end_ms}."
    )

    if (
        not dependencies.force
        and not dependencies.dry_run
        and not plan.needs_sending(dependencies.state, window.end_ms)
    ):
        dependencies.log(
            f"The {plan.label.lower()} report for the window ending "
            f"{window.end_ms} was already sent."
        )
        return WeeklyOutcome("skipped", False)

    try:
        dependencies.log("Collecting engagement from WhatsApp...")
        collected = dependencies.collect(window)
        body = render_monthly_activity_summary(list(collected.items), list(collected.warnings))
        empty_week = len(collected.items) == 0
        dependencies.log(
            f"Collected {len(collected.items)} activity item(s); the period is "
            f"{'empty' if empty_week else 'not empty'}."
        )

        if dependencies.dry_run:
            dependencies.log(
                f"Dry run: not sending to {dependencies.recipient_chat_id} "
                "and not updating the state file."
            )
            dependencies.log(render_weekly_report(window, "" if empty_week else body))
            return WeeklyOutcome("dry-run", empty_week)

        dependencies.log(
            f"Sending the {plan.label.lower()} report to {dependencies.recipient_chat_id}..."
        )
        dependencies.send_message(
            dependencies.recipient_chat_id,
            render_weekly_report(window, "" if empty_week else body),
        )
        dependencies.save_state(plan.record_sent(dependencies.state, window.end_ms))
        dependencies.log(
            f"Sent the {plan.label.lower()} report for the window ending {window.end_ms}."
        )

        if empty_week and dependencies.self_chat_id is not None:
            try:
                dependencies.send_message(
                    dependencies.self_chat_id, render_weekly_report(window, "")
                )
            except Exception as notice_error:
                dependencies.log(
                    "The empty-period notice could not be sent to you: "
                    f"{error_message(notice_error)}"
                )

        return WeeklyOutcome("sent", empty_week)
    except Exception as error:
        _alert_best_effort(dependencies, window, error)
        raise


def run_weekly_report(dependencies: ReportDependencies) -> WeeklyOutcome:
    return _run_report(
        dependencies,
        ReportPlan(
            label="Weekly",
            window=compute_weekly_window(dependencies.now),
            needs_sending=should_send_report,
            record_sent=lambda state, window_end_ms: WeeklyState(
                last_report_window_end=max(
                    state.last_report_window_end
                    if state.last_report_window_end is not None
                    else window_end_ms,
                    window_end_ms,
                ),
                last_alert_window_end=state.last_alert_window_end,
                last_month_end_window_end=state.last_month_end_window_end,
            ),
        ),
    )


def run_month_end_report(dependencies: ReportDependencies) -> WeeklyOutcome:
    window = compute_month_end_window(dependencies.now, dependencies.state.last_report_window_end)
    if window.start_ms >= window.end_ms:
        dependencies.log(
            "No complete days have passed since the last report; skipping the month-end report."
        )
        return WeeklyOutcome("skipped", False)
    return _run_report(
        dependencies,
        ReportPlan(
            label="Month-end",
            window=window,
            needs_sending=should_send_month_end,
            record_sent=lambda state, window_end_ms: WeeklyState(
                last_report_window_end=state.last_report_window_end,
                last_alert_window_end=state.last_alert_window_end,
                last_month_end_window_end=window_end_ms,
            ),
        ),
    )
