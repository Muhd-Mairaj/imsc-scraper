from pathlib import Path

import pytest

from imsc.collect import CollectionError, collect_engagement, discover_markers
from imsc.config import AppConfig, SelectedChat
from imsc.schedule import WeeklyWindow
from imsc.store import EventStore
from imsc.waha import WahaMessage

DAY_MS = 86_400_000
START_MS = 1_790_000_000_000
END_MS = START_MS + 7 * DAY_MS
START_S = START_MS // 1000
WINDOW = WeeklyWindow(START_MS, END_MS)


class FakeWaha:
    def __init__(self, messages, oldest=None, contacts=None, lids=None):
        self._messages = messages
        self._oldest = oldest
        self._contacts = contacts or {}
        self._lids = lids or {}

    def messages(self, _chat_id, _start_ms, _end_ms):
        return self._messages

    def oldest_message(self, _chat_id):
        return self._oldest

    def phone_for_lid(self, lid):
        return self._lids.get(lid)

    def contact(self, chat_id):
        return self._contacts.get(chat_id)


def message(**values) -> WahaMessage:
    if "from_" in values:
        values["from"] = values.pop("from_")
    return WahaMessage(values)


def marker(timestamp: int, body: str = "*BI - Weekly*") -> WahaMessage:
    return message(
        id=f"marker-{timestamp}",
        timestamp=timestamp,
        from_="g@g.us",
        fromMe=False,
        body=body,
        participant="admin@lid",
    )


def poll(timestamp: int, poll_id: str = "poll1", **extra) -> WahaMessage:
    raw = {
        "id": poll_id,
        "timestamp": timestamp,
        "from": "g@g.us",
        "fromMe": False,
        "_data": {"message": {"pollCreationMessage": {"name": "Checkin"}}},
    }
    raw.update(extra)
    return WahaMessage(raw)


def reaction_post(timestamp: int, sender: str = "bob@lid") -> WahaMessage:
    return message(
        id=f"post-{timestamp}",
        timestamp=timestamp,
        from_="g@g.us",
        fromMe=False,
        _data={"reactions": [{"key": {"participant": sender, "fromMe": False}, "text": "👍"}]},
    )


def config(ignored=()) -> AppConfig:
    return AppConfig(
        selected_chat=SelectedChat("g@g.us", "Group"),
        ignored_phone_numbers=tuple(ignored),
        weekly_report_recipient="60123",
    )


def store(tmp_path: Path) -> EventStore:
    value = EventStore(tmp_path / "events.sqlite3")
    value.init()
    return value


def oldest_before_window() -> WahaMessage:
    return message(id="old", timestamp=START_S - 3600, from_="g@g.us", fromMe=False)


def test_a_poll_marker_uses_store_votes_and_resolves_the_voter(tmp_path: Path):
    events = store(tmp_path)
    events.upsert_poll_vote("poll1", "alice@lid", ["Yes"], START_S)
    waha = FakeWaha(
        [marker(START_S + 3600), poll(START_S + 7200)],
        oldest=oldest_before_window(),
        contacts={
            "alice@lid": {"username": "alice", "number": "60123"},
            "60123@c.us": {"number": "60123"},
        },
        lids={"alice@lid": "60123@c.us"},
    )

    result = collect_engagement(waha, config(), events, WINDOW, "me@lid")

    assert len(result.items) == 1
    assert result.items[0].activity == 2
    assert result.items[0].participant_displays == ("@alice",)
    assert result.warnings == ()


def test_a_reaction_marker_uses_reaction_senders(tmp_path: Path):
    waha = FakeWaha(
        [marker(START_S + 3600), reaction_post(START_S + 7200)],
        oldest=oldest_before_window(),
        contacts={
            "bob@lid": {"username": "bob", "number": "60124"},
            "60124@c.us": {"number": "60124"},
        },
        lids={"bob@lid": "60124@c.us"},
    )

    result = collect_engagement(waha, config(), store(tmp_path), WINDOW, "me@lid")

    assert len(result.items) == 1
    assert result.items[0].activity == 1
    assert result.items[0].participant_displays == ("@bob",)


def test_ignored_phone_numbers_are_filtered_by_resolved_phone(tmp_path: Path):
    events = store(tmp_path)
    events.upsert_poll_vote("poll1", "alice@lid", ["Yes"], START_S)
    waha = FakeWaha(
        [marker(START_S + 3600), poll(START_S + 7200)],
        oldest=oldest_before_window(),
        contacts={"alice@lid": {"username": "alice", "number": "60123"}},
        lids={"alice@lid": "60123@c.us"},
    )

    result = collect_engagement(waha, config(ignored=("60123",)), events, WINDOW, "me@lid")

    assert len(result.items) == 1
    assert result.items[0].participant_displays == ()


def test_a_revoked_follow_up_uses_a_same_day_replacement(tmp_path: Path):
    base = START_S + 12 * 3600
    revoked = message(
        id="revoked",
        timestamp=base + 3600,
        from_="g@g.us",
        fromMe=False,
        _data={"message": {"protocolMessage": {"type": "REVOKE"}}},
    )
    replacement = reaction_post(base + 7200)
    waha = FakeWaha(
        [marker(base), revoked, replacement],
        oldest=oldest_before_window(),
        contacts={
            "bob@lid": {"username": "bob", "number": "60124"},
            "60124@c.us": {"number": "60124"},
        },
        lids={"bob@lid": "60124@c.us"},
    )

    result = collect_engagement(waha, config(), store(tmp_path), WINDOW, "me@lid")

    assert len(result.items) == 1
    assert result.items[0].timestamp_ms == (base + 7200) * 1000
    assert any("same-day replacement" in warning for warning in result.warnings)


def test_a_title_followed_by_another_title_has_no_marker():
    messages = [
        marker(START_S + 3600),
        marker(START_S + 7200),
    ]
    assert discover_markers(messages, START_MS, END_MS) == []


def test_incomplete_history_fails_closed_in_strict_mode(tmp_path: Path):
    waha = FakeWaha(
        [marker(START_S + 3600), poll(START_S + 7200)],
        oldest=message(id="newest", timestamp=START_S + 3600, from_="g@g.us", fromMe=False),
    )

    with pytest.raises(CollectionError, match="does not reach the report start"):
        collect_engagement(waha, config(), store(tmp_path), WINDOW, "me@lid")


def test_incomplete_history_is_a_warning_in_lenient_mode(tmp_path: Path):
    waha = FakeWaha(
        [marker(START_S + 3600), poll(START_S + 7200)],
        oldest=message(id="newest", timestamp=START_S + 3600, from_="g@g.us", fromMe=False),
    )

    result = collect_engagement(waha, config(), store(tmp_path), WINDOW, "me@lid", strict=False)

    assert any("History may not reach" in warning for warning in result.warnings)


def test_stored_poll_updates_supply_voters_before_the_ingester_started(tmp_path: Path):
    poll_with_updates = poll(
        START_S + 7200,
        _data={
            "message": {"pollCreationMessage": {"name": "Checkin"}},
            "pollUpdates": [{"pollUpdateMessageKey": {"participant": "alice@lid"}}],
        },
    )
    waha = FakeWaha(
        [marker(START_S + 3600), poll_with_updates],
        oldest=oldest_before_window(),
        contacts={"alice@lid": {"username": "alice", "number": "60123"}},
        lids={"alice@lid": "60123@c.us"},
    )

    result = collect_engagement(waha, config(), store(tmp_path), WINDOW, "me@lid")

    assert result.items[0].participant_displays == ("@alice",)
    assert any("stored poll updates" in warning for warning in result.warnings)


def test_encrypted_poll_updates_without_voter_keys_fail_closed(tmp_path: Path):
    poll_with_updates = poll(
        START_S + 7200,
        _data={
            "message": {"pollCreationMessage": {"name": "Checkin"}},
            "pollUpdates": [{"vote": "encrypted"}],
        },
    )
    waha = FakeWaha(
        [marker(START_S + 3600), poll_with_updates],
        oldest=oldest_before_window(),
    )

    with pytest.raises(CollectionError, match="no recoverable voter identities"):
        collect_engagement(waha, config(), store(tmp_path), WINDOW, "me@lid")


def test_a_chat_with_no_stored_messages_fails_closed(tmp_path: Path):
    waha = FakeWaha([], oldest=None)
    with pytest.raises(CollectionError, match="no stored messages"):
        collect_engagement(waha, config(), store(tmp_path), WINDOW, "me@lid")
