import json

import httpx
import pytest

from imsc.waha import WahaClient, WahaError, WahaMessage


def client(handler) -> WahaClient:
    return WahaClient(
        "http://waha:3000",
        session="default",
        api_key="secret",
        transport=httpx.MockTransport(handler),
    )


def test_messages_use_seconds_in_the_timestamp_filters():
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            json=[
                {
                    "id": "m1",
                    "timestamp": 1_699_999_000,
                    "from": "g@g.us",
                    "fromMe": False,
                    "body": "hello",
                }
            ],
        )

    messages = client(handler).messages("g@g.us", 1_699_990_000_000, 1_700_000_000_000)

    assert messages[0].body == "hello"
    query = requests[0].url.params
    assert query["filter.timestamp.gte"] == "1699990000"
    assert query["filter.timestamp.lte"] == "1699999999"
    assert query["sortOrder"] == "asc"
    assert requests[0].headers["X-Api-Key"] == "secret"


def test_groups_accept_the_group_wrapper_and_sort_by_name():
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "groups": [
                    {"id": "b@g.us", "subject": "Zulu"},
                    {"id": "a@g.us", "subject": "Alpha"},
                ]
            },
        )

    groups = client(handler).groups()
    assert [group.name for group in groups] == ["Alpha", "Zulu"]


def test_send_text_posts_the_session_chat_and_text():
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(201, json={"id": "true_g@g.us_ABC", "ack": 1})

    sent = client(handler).send_text("g@g.us", "report")
    body = json.loads(requests[0].content)
    assert body == {
        "session": "default",
        "chatId": "g@g.us",
        "text": "report",
        "linkPreview": False,
    }
    assert WahaMessage(sent).id == "true_g@g.us_ABC"


def test_lid_mappings_are_read_from_their_endpoints():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/lids/pn/60123"):
            return httpx.Response(200, json={"lid": "123@lid", "pn": "60123@c.us"})
        if request.url.path.endswith("/lids/123@lid"):
            return httpx.Response(200, json={"lid": "123@lid", "pn": "60123@c.us"})
        return httpx.Response(404)

    client_instance = client(handler)
    assert client_instance.lid_for_phone("60123") == "123@lid"
    assert client_instance.phone_for_lid("123@lid") == "60123@c.us"


def test_a_missing_contact_is_none_not_an_error():
    assert client(lambda _: httpx.Response(404)).contact("123@lid") is None


def test_an_error_status_becomes_a_waha_error():
    with pytest.raises(WahaError, match="500"):
        client(lambda _: httpx.Response(500, text="boom")).session_info()


def test_wait_until_working_polls_the_session_status():
    statuses = iter(["STARTING", "WORKING"])
    seen: list[str] = []

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"status": next(statuses)})

    info = client(handler).wait_until_working(
        timeout=1, interval=0.001, on_status=lambda status, _: seen.append(status)
    )
    assert info["status"] == "WORKING"
    assert seen == ["STARTING"]


def test_message_parses_a_poll_revoke_reactions_and_ack():
    poll = WahaMessage(
        {
            "id": "poll1",
            "timestamp": 1_700_000_000,
            "from": "g@g.us",
            "fromMe": False,
            "ack": 2,
            "_data": {"message": {"pollCreationMessage": {"name": "Checkin"}}},
        }
    )
    assert poll.is_poll
    assert poll.body == "Checkin"
    assert poll.ack == 2
    assert poll.sender_id == "g@g.us"

    revoked = WahaMessage(
        {
            "id": "revoked",
            "timestamp": 1_700_000_001,
            "_data": {"message": {"protocolMessage": {"type": "REVOKE"}}},
        }
    )
    assert revoked.is_revoked

    reacted = WahaMessage(
        {
            "id": "post",
            "timestamp": 1_700_000_002,
            "_data": {"reactions": [{"key": {"participant": "a@lid"}, "text": "👍"}]},
        }
    )
    assert reacted.reactions[0]["text"] == "👍"


def test_messages_before_uses_an_inclusive_upper_bound_and_descending_order():
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            json=[{"id": "old", "timestamp": 1_699_999_000, "body": "x"}],
        )

    client(handler).messages_before("g@g.us", 1_700_000_000_000)

    query = requests[0].url.params
    assert query["limit"] == "1"
    assert query["sortOrder"] == "desc"
    assert query["filter.timestamp.lte"] == "1699999999"
