from pathlib import Path

from fastapi.testclient import TestClient

from imsc.ingest import create_app
from imsc.store import EventStore


def setup(tmp_path: Path) -> tuple[TestClient, EventStore]:
    app = create_app(tmp_path)
    return TestClient(app), EventStore(tmp_path / "waha-events.sqlite3")


def test_poll_vote_events_are_recorded(tmp_path: Path):
    client, events = setup(tmp_path)
    response = client.post(
        "/webhook",
        json={
            "event": "poll.vote",
            "me": {"id": "me@lid"},
            "payload": {
                "poll": {"id": "poll1"},
                "vote": {
                    "from": "alice@lid",
                    "selectedOptions": ["Yes"],
                    "timestamp": 1_700_000_000,
                },
            },
        },
    )
    assert response.json() == {"ok": True}
    voters = events.poll_voters("poll1")
    assert [vote.voter_id for vote in voters] == ["alice@lid"]
    assert voters[0].selected_options == ("Yes",)


def test_own_poll_vote_uses_the_session_identity(tmp_path: Path):
    client, events = setup(tmp_path)
    client.post(
        "/webhook",
        json={
            "event": "poll.vote",
            "me": {"id": "me@lid"},
            "payload": {
                "poll": {"id": "poll1"},
                "vote": {"fromMe": True, "selectedOptions": ["Yes"], "timestamp": 1},
            },
        },
    )
    assert events.poll_voters("poll1")[0].voter_id == "me@lid"


def test_reaction_events_are_upserted_and_cleared(tmp_path: Path):
    client, events = setup(tmp_path)
    common = {
        "event": "message.reaction",
        "me": {"id": "me@lid"},
        "payload": {
            "participant": "bob@lid",
            "reaction": {"messageId": "post1", "text": "👍"},
            "timestamp": 1,
        },
    }
    client.post("/webhook", json=common)
    assert events.reaction_senders("post1")[0].emoji == "👍"

    common["payload"]["reaction"]["text"] = ""
    client.post("/webhook", json=common)
    assert events.reaction_senders("post1") == []


def test_health_reports_store_counts(tmp_path: Path):
    client, events = setup(tmp_path)
    events.upsert_poll_vote("poll1", "alice@lid", ["Yes"], 1)
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["poll_votes"] == 1


def test_malformed_events_are_acknowledged_and_ignored(tmp_path: Path):
    client, events = setup(tmp_path)
    response = client.post("/webhook", json={"event": "poll.vote", "payload": {}})
    assert response.json() == {"ok": True}
    assert events.counts() == {"poll_votes": 0, "reactions": 0}
