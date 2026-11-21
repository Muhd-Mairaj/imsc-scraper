import json
from datetime import datetime

import httpx
import pytest

from imsc import cli
from imsc.collect import CollectionError
from imsc.schedule import TZ
from imsc.waha import WahaClient


def seconds(year: int, month: int, day: int, hour: int = 0) -> int:
    return int(datetime(year, month, day, hour, tzinfo=TZ).timestamp())


def make_handler() -> tuple[httpx.MockTransport, dict[str, object]]:
    state: dict[str, object] = {}
    oldest = {
        "id": "oldest",
        "timestamp": seconds(2026, 11, 1),
        "from": "g@g.us",
        "fromMe": False,
        "body": "older",
    }
    marker = {
        "id": "marker",
        "timestamp": seconds(2026, 11, 8, 10),
        "from": "g@g.us",
        "fromMe": False,
        "body": "*BI - Weekly*",
    }
    post = {
        "id": "post",
        "timestamp": seconds(2026, 11, 8, 11),
        "from": "g@g.us",
        "fromMe": False,
        "_data": {"reactions": [{"key": {"participant": "bob@lid"}, "text": "👍"}]},
    }

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/api/sessions/default":
            return httpx.Response(200, json={"status": "WORKING"})
        if path == "/api/sessions/default/me":
            return httpx.Response(200, json={"id": "me@c.us", "lid": "me@lid"})
        if path == "/api/default/lids/pn/60123":
            return httpx.Response(200, json={"lid": "recipient@lid", "pn": "60123@c.us"})
        if path == "/api/default/lids/bob@lid":
            return httpx.Response(200, json={"lid": "bob@lid", "pn": "60124@c.us"})
        if path == "/api/default/contacts/bob@lid":
            return httpx.Response(200, json={"username": "bob", "number": "60124"})
        if path == "/api/default/contacts/60124@c.us":
            return httpx.Response(200, json={"number": "60124"})
        if path.startswith("/api/default/contacts/"):
            return httpx.Response(200, json={})
        if path == "/api/default/chats/g@g.us/messages":
            state["last_query"] = str(request.url)
            if request.url.params.get("limit") == "1":
                return httpx.Response(200, json=[oldest])
            return httpx.Response(200, json=[oldest, marker, post])
        return httpx.Response(404)

    return httpx.MockTransport(handler), state


def test_weekly_dry_run_through_the_cli(tmp_path, monkeypatch, capsys):
    (tmp_path / "config.json").write_text(
        json.dumps(
            {
                "selectedChat": {"id": "g@g.us", "name": "Group"},
                "ignoredPhoneNumbers": [],
                "weeklyReportRecipient": "60123",
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("IMSC_DATA_DIR", str(tmp_path))
    transport, state = make_handler()
    client = WahaClient("http://waha", transport=transport)
    monkeypatch.setattr(cli, "_waha_client", lambda: client)

    cli.main(["weekly", "--week", "2026-11-14", "--dry-run"])

    output = capsys.readouterr().out
    assert "*08/11/2026*" in output
    assert "@bob - 1" in output
    assert "14/11/2026" not in output
    assert "07/11/2026 – 13/11/2026" in output
    assert "filter.timestamp.gte=" in str(state["last_query"])


def test_the_report_fails_closed_when_the_ingester_is_unreachable(monkeypatch):
    monkeypatch.setenv("IMSC_INGEST_URL", "http://127.0.0.1:1")
    with pytest.raises(CollectionError, match="not reachable"):
        cli._ensure_ingester()


def test_no_ingester_url_skips_the_health_check(monkeypatch):
    monkeypatch.delenv("IMSC_INGEST_URL", raising=False)
    cli._ensure_ingester()
