from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path


def _timestamp_ms(value: object) -> int | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        number = int(value)
    elif isinstance(value, str):
        try:
            number = int(float(value))
        except ValueError:
            return None
    else:
        return None
    # WAHA documents most timestamps as milliseconds but some engines send
    # seconds. Normalise anything that is clearly seconds.
    return number * 1000 if abs(number) < 10_000_000_000 else number


@dataclass(frozen=True)
class PollVoter:
    voter_id: str
    selected_options: tuple[str, ...]
    timestamp_ms: int | None


@dataclass(frozen=True)
class ReactionSender:
    reactor_id: str
    emoji: str
    timestamp_ms: int | None


class EventStore:
    """SQLite store for the events WAHA sends while the ingester is running.

    Message history comes from WAHA's own store. This database exists for the
    two things WhatsApp only sends as live events: decrypted poll votes and
    reaction changes.
    """

    def __init__(self, path: Path) -> None:
        self.path = path

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=30)
        connection.row_factory = sqlite3.Row
        return connection

    def init(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with self._connect() as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS poll_votes (
                    poll_id TEXT NOT NULL,
                    voter_id TEXT NOT NULL,
                    selected_options TEXT NOT NULL,
                    timestamp_ms INTEGER,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (poll_id, voter_id)
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS reactions (
                    message_id TEXT NOT NULL,
                    reactor_id TEXT NOT NULL,
                    emoji TEXT NOT NULL,
                    timestamp_ms INTEGER,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (message_id, reactor_id)
                )
                """
            )
            connection.commit()

    def upsert_poll_vote(
        self,
        poll_id: str,
        voter_id: str,
        selected_options: list[str] | tuple[str, ...],
        timestamp: object,
    ) -> None:
        if not poll_id or not voter_id:
            return
        with self._connect() as connection:
            if not selected_options:
                connection.execute(
                    "DELETE FROM poll_votes WHERE poll_id = ? AND voter_id = ?",
                    (poll_id, voter_id),
                )
            else:
                connection.execute(
                    """
                    INSERT INTO poll_votes
                        (poll_id, voter_id, selected_options, timestamp_ms, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(poll_id, voter_id) DO UPDATE SET
                        selected_options = excluded.selected_options,
                        timestamp_ms = excluded.timestamp_ms,
                        updated_at = excluded.updated_at
                    """,
                    (
                        poll_id,
                        voter_id,
                        json.dumps(list(selected_options), ensure_ascii=False),
                        _timestamp_ms(timestamp),
                        datetime.now(UTC).isoformat(timespec="milliseconds"),
                    ),
                )
            connection.commit()

    def poll_voters(self, poll_id: str) -> list[PollVoter]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT voter_id, selected_options, timestamp_ms "
                "FROM poll_votes WHERE poll_id = ? ORDER BY voter_id",
                (poll_id,),
            ).fetchall()
        return [
            PollVoter(
                voter_id=row["voter_id"],
                selected_options=tuple(json.loads(row["selected_options"])),
                timestamp_ms=row["timestamp_ms"],
            )
            for row in rows
        ]

    def upsert_reaction(
        self,
        message_id: str,
        reactor_id: str,
        emoji: str,
        timestamp: object,
    ) -> None:
        if not message_id or not reactor_id:
            return
        with self._connect() as connection:
            if not emoji:
                connection.execute(
                    "DELETE FROM reactions WHERE message_id = ? AND reactor_id = ?",
                    (message_id, reactor_id),
                )
            else:
                connection.execute(
                    """
                    INSERT INTO reactions
                        (message_id, reactor_id, emoji, timestamp_ms, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(message_id, reactor_id) DO UPDATE SET
                        emoji = excluded.emoji,
                        timestamp_ms = excluded.timestamp_ms,
                        updated_at = excluded.updated_at
                    """,
                    (
                        message_id,
                        reactor_id,
                        emoji,
                        _timestamp_ms(timestamp),
                        datetime.now(UTC).isoformat(timespec="milliseconds"),
                    ),
                )
            connection.commit()

    def reaction_senders(self, message_id: str) -> list[ReactionSender]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT reactor_id, emoji, timestamp_ms "
                "FROM reactions WHERE message_id = ? ORDER BY reactor_id",
                (message_id,),
            ).fetchall()
        return [
            ReactionSender(
                reactor_id=row["reactor_id"],
                emoji=row["emoji"],
                timestamp_ms=row["timestamp_ms"],
            )
            for row in rows
        ]

    def counts(self) -> dict[str, int]:
        with self._connect() as connection:
            poll_votes = connection.execute("SELECT COUNT(*) FROM poll_votes").fetchone()[0]
            reactions = connection.execute("SELECT COUNT(*) FROM reactions").fetchone()[0]
        return {"poll_votes": int(poll_votes), "reactions": int(reactions)}
