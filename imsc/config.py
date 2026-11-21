from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from .utils import phone_digits


class ConfigError(RuntimeError):
    pass


@dataclass(frozen=True)
class SelectedChat:
    id: str
    name: str


@dataclass(frozen=True)
class AppConfig:
    selected_chat: SelectedChat
    ignored_phone_numbers: tuple[str, ...]
    weekly_report_recipient: str | None


def data_directory() -> Path:
    return Path(os.environ.get("IMSC_DATA_DIR", "data")).resolve()


def config_file_path() -> Path:
    return data_directory() / "config.json"


def weekly_state_path() -> Path:
    return data_directory() / "weekly-state.json"


def events_database_path() -> Path:
    return data_directory() / "waha-events.sqlite3"


def logs_directory() -> Path:
    return data_directory() / "logs"


def monthly_summary_file_path(now: datetime) -> Path:
    return data_directory() / f"monthly-{now.year}-{now.month:02d}.txt"


def normalize_phone_numbers(values: list[str] | tuple[str, ...]) -> tuple[str, ...]:
    seen: dict[str, None] = {}
    for value in values:
        digits = phone_digits(value)
        if digits:
            seen.setdefault(digits, None)
    return tuple(seen)


def _invalid(path: Path) -> ConfigError:
    return ConfigError(f"Invalid selected chat config at {path}. Run `imsc setup` again.")


def load_config(path: Path | None = None) -> AppConfig:
    config_path = path or config_file_path()
    try:
        raw = config_path.read_text(encoding="utf-8")
    except FileNotFoundError as error:
        raise ConfigError("Run `imsc setup` first.") from error
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as error:
        raise _invalid(config_path) from error

    if not isinstance(parsed, dict):
        raise _invalid(config_path)
    selected = parsed.get("selectedChat")
    if (
        not isinstance(selected, dict)
        or not isinstance(selected.get("id"), str)
        or not selected["id"].strip()
        or not isinstance(selected.get("name"), str)
        or not selected["name"].strip()
    ):
        raise _invalid(config_path)

    ignored = parsed.get("ignoredPhoneNumbers", [])
    if not isinstance(ignored, list) or any(not isinstance(value, str) for value in ignored):
        raise _invalid(config_path)

    recipient = parsed.get("weeklyReportRecipient")
    if recipient is not None and not isinstance(recipient, str):
        raise _invalid(config_path)

    normalized_recipient = normalize_phone_numbers([recipient]) if recipient else ()
    return AppConfig(
        selected_chat=SelectedChat(id=selected["id"].strip(), name=selected["name"].strip()),
        ignored_phone_numbers=normalize_phone_numbers(ignored),
        weekly_report_recipient=normalized_recipient[0] if normalized_recipient else None,
    )


def save_config(config: AppConfig, path: Path | None = None) -> None:
    config_path = path or config_file_path()
    config_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    payload: dict[str, object] = {
        "selectedChat": {"id": config.selected_chat.id, "name": config.selected_chat.name},
        "ignoredPhoneNumbers": list(normalize_phone_numbers(config.ignored_phone_numbers)),
    }
    if config.weekly_report_recipient is not None:
        payload["weeklyReportRecipient"] = normalize_phone_numbers(
            [config.weekly_report_recipient]
        )[0]
    temporary_path = config_path.with_name(f"{config_path.name}.{os.getpid()}.tmp")
    temporary_path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    temporary_path.chmod(0o600)
    temporary_path.replace(config_path)
