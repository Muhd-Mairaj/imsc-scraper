from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from .schedule import format_date

ActivityValue = Literal[1, 2]


@dataclass(frozen=True)
class ActivityItem:
    timestamp_ms: int
    activity: ActivityValue
    participant_displays: tuple[str, ...]


def format_activity_date(timestamp_ms: int) -> str:
    return format_date(timestamp_ms)


def render_monthly_activity_summary(
    items: list[ActivityItem] | tuple[ActivityItem, ...],
    warnings: list[str] | tuple[str, ...],
) -> str:
    sections: dict[str, tuple[int, list[str]]] = {}
    for item in sorted(items, key=lambda entry: entry.timestamp_ms):
        heading = f"*{format_activity_date(item.timestamp_ms)}*"
        section = sections.setdefault(heading, (item.timestamp_ms, []))
        for display in item.participant_displays:
            section[1].append(f"{display} - {item.activity}")

    output: list[str] = []
    for heading, (_, lines) in sorted(sections.items(), key=lambda entry: entry[1][0]):
        output.append(heading)
        output.extend(sorted(lines))
        output.append("")

    unique_warnings = list(dict.fromkeys(warnings))
    if unique_warnings:
        if output:
            output.append("")
        output.append("Warnings:")
        output.extend(f"- {warning}" for warning in unique_warnings)

    if not output:
        return ""
    return "\n".join(output) + "\n"


__all__ = [
    "ActivityItem",
    "ActivityValue",
    "format_activity_date",
    "render_monthly_activity_summary",
]
