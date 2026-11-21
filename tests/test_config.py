from pathlib import Path

import pytest

from imsc.config import (
    AppConfig,
    ConfigError,
    SelectedChat,
    load_config,
    normalize_phone_numbers,
    save_config,
)


def test_normalizes_and_deduplicates_ignored_phone_numbers():
    assert normalize_phone_numbers(
        ["+60 12-345 6789", "60123456789", "", "  +60 12 345 6789  "]
    ) == ("60123456789",)


def test_loads_a_config_without_a_weekly_recipient(tmp_path: Path):
    path = tmp_path / "config.json"
    path.write_text(
        '{"selectedChat":{"id":"1@g.us","name":"Group"},"ignoredPhoneNumbers":[]}',
        encoding="utf-8",
    )
    config = load_config(path)
    assert config.weekly_report_recipient is None


def test_normalizes_the_weekly_recipient_on_save_and_read(tmp_path: Path):
    path = tmp_path / "config.json"
    save_config(
        AppConfig(
            selected_chat=SelectedChat("1@g.us", "Group"),
            ignored_phone_numbers=(),
            weekly_report_recipient="+60 12-345 6789",
        ),
        path,
    )
    assert load_config(path).weekly_report_recipient == "60123456789"


def test_rejects_a_non_string_weekly_recipient(tmp_path: Path):
    path = tmp_path / "config.json"
    path.write_text(
        '{"selectedChat":{"id":"1@g.us","name":"Group"},'
        '"ignoredPhoneNumbers":[],"weeklyReportRecipient":42}',
        encoding="utf-8",
    )
    with pytest.raises(ConfigError, match="Invalid selected chat config"):
        load_config(path)


def test_missing_config_asks_for_setup(tmp_path: Path):
    with pytest.raises(ConfigError, match="setup"):
        load_config(tmp_path / "missing.json")
