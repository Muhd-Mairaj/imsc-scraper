from pathlib import Path

from imsc.store import EventStore


def store(tmp_path: Path) -> EventStore:
    value = EventStore(tmp_path / "events.sqlite3")
    value.init()
    return value


def test_poll_votes_are_upserted_replaced_and_cleared(tmp_path: Path):
    events = store(tmp_path)
    events.upsert_poll_vote("poll1", "alice@lid", ["Yes"], 1_700_000_000)
    events.upsert_poll_vote("poll1", "bob@lid", ["No"], 1_700_000_001)

    assert [vote.voter_id for vote in events.poll_voters("poll1")] == [
        "alice@lid",
        "bob@lid",
    ]
    assert events.poll_voters("poll1")[0].timestamp_ms == 1_700_000_000_000

    events.upsert_poll_vote("poll1", "alice@lid", ["No", "Maybe"], 1_700_000_002)
    alice = events.poll_voters("poll1")[0]
    assert alice.selected_options == ("No", "Maybe")

    events.upsert_poll_vote("poll1", "alice@lid", [], 1_700_000_003)
    assert [vote.voter_id for vote in events.poll_voters("poll1")] == ["bob@lid"]


def test_reactions_are_upserted_and_cleared(tmp_path: Path):
    events = store(tmp_path)
    events.upsert_reaction("post1", "alice@lid", "👍", 1_700_000_000)
    assert events.reaction_senders("post1")[0].emoji == "👍"

    events.upsert_reaction("post1", "alice@lid", "❤️", 1_700_000_001)
    assert events.reaction_senders("post1")[0].emoji == "❤️"

    events.upsert_reaction("post1", "alice@lid", "", 1_700_000_002)
    assert events.reaction_senders("post1") == []


def test_counts_report_both_tables(tmp_path: Path):
    events = store(tmp_path)
    events.upsert_poll_vote("poll1", "alice@lid", ["Yes"], 1)
    events.upsert_reaction("post1", "bob@lid", "👍", 1)
    assert events.counts() == {"poll_votes": 1, "reactions": 1}
