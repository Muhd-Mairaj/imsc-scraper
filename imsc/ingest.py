from __future__ import annotations

import os
from pathlib import Path
from typing import Annotated, Any

import uvicorn
from fastapi import Body, FastAPI

from .config import events_database_path
from .store import EventStore


def _voter_id(payload: dict[str, Any], vote: dict[str, Any], me_id: str | None) -> str | None:
    if vote.get("fromMe") is True and me_id:
        return me_id
    for key in ("participant", "from", "to"):
        value = vote.get(key)
        if isinstance(value, str) and value:
            return value
    return None


def _reactor_id(payload: dict[str, Any], me_id: str | None) -> str | None:
    if payload.get("fromMe") is True and me_id:
        return me_id
    for key in ("participant", "from", "author"):
        value = payload.get(key)
        if isinstance(value, str) and value:
            return value
    return None


def create_app(data_dir: Path | None = None) -> FastAPI:
    store = EventStore(data_dir / "waha-events.sqlite3" if data_dir else events_database_path())
    store.init()
    app = FastAPI(title="imsc-waha-ingest", docs_url=None, redoc_url=None)

    @app.get("/health")
    def health() -> dict[str, Any]:
        return {"status": "ok", "database": str(store.path), **store.counts()}

    @app.post("/webhook")
    def webhook(body: Annotated[dict[str, Any], Body()]) -> dict[str, bool]:
        event = body.get("event")
        payload = body.get("payload")
        me = body.get("me")
        me_id = me.get("id") if isinstance(me, dict) else None
        if not isinstance(payload, dict):
            return {"ok": True}

        if event == "poll.vote":
            vote = payload.get("vote")
            poll = payload.get("poll")
            if isinstance(vote, dict) and isinstance(poll, dict):
                poll_id = poll.get("id")
                voter = _voter_id(payload, vote, me_id)
                if isinstance(poll_id, str) and voter:
                    selected = vote.get("selectedOptions")
                    store.upsert_poll_vote(
                        poll_id,
                        voter,
                        selected if isinstance(selected, list) else [],
                        vote.get("timestamp"),
                    )
        elif event == "message.reaction":
            reaction = payload.get("reaction")
            if isinstance(reaction, dict):
                message_id = reaction.get("messageId")
                reactor = _reactor_id(payload, me_id)
                if isinstance(message_id, str) and reactor:
                    emoji = reaction.get("text")
                    store.upsert_reaction(
                        message_id,
                        reactor,
                        emoji if isinstance(emoji, str) else "",
                        payload.get("timestamp"),
                    )
        return {"ok": True}

    return app


app = create_app()


def run_ingest() -> None:
    uvicorn.run(
        "imsc.ingest:app",
        host=os.environ.get("IMSC_INGEST_HOST", "0.0.0.0"),
        port=int(os.environ.get("IMSC_INGEST_PORT", "8000")),
        log_level="info",
    )
