from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any
from urllib.parse import quote

import httpx

from .schedule import TZ

JSON = dict[str, Any]


class WahaError(RuntimeError):
    pass


def _value(raw: JSON, *keys: str, default: Any = None) -> Any:
    for key in keys:
        if key in raw and raw[key] is not None:
            return raw[key]
    return default


def _int_timestamp(value: object) -> int | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        try:
            return int(float(value))
        except ValueError:
            return None
    return None


@dataclass(frozen=True)
class WahaGroup:
    id: str
    name: str


@dataclass(frozen=True)
class WahaMessage:
    raw: JSON

    @property
    def id(self) -> str | None:
        value = _value(self.raw, "id")
        return value if isinstance(value, str) and value else None

    @property
    def timestamp_s(self) -> int | None:
        return _int_timestamp(_value(self.raw, "timestamp"))

    @property
    def timestamp_ms(self) -> int | None:
        seconds = self.timestamp_s
        return seconds * 1000 if seconds is not None else None

    @property
    def from_me(self) -> bool:
        return self.raw.get("fromMe") is True

    @property
    def sender_id(self) -> str | None:
        if self.from_me:
            return None
        for key in ("participant", "author", "from"):
            value = self.raw.get(key)
            if isinstance(value, str) and value:
                return value
        return None

    @property
    def message_data(self) -> JSON:
        data = self.raw.get("_data")
        if not isinstance(data, dict):
            return {}
        message = data.get("message") or data.get("Message")
        return message if isinstance(message, dict) else {}

    @property
    def body(self) -> str:
        value = self.raw.get("body")
        if isinstance(value, str) and value.strip():
            return value
        data = self.message_data
        for key in ("conversation", "extendedTextMessage", "imageMessage", "videoMessage"):
            payload = data.get(key)
            if isinstance(payload, str):
                return payload
            if isinstance(payload, dict):
                text = payload.get("text") or payload.get("caption")
                if isinstance(text, str):
                    return text
        poll = self._poll_creation()
        name = poll.get("name") if isinstance(poll, dict) else None
        return name if isinstance(name, str) else ""

    @property
    def is_poll(self) -> bool:
        return bool(self._poll_creation())

    def _poll_creation(self) -> JSON | None:
        data = self.message_data
        for key in (
            "pollCreationMessage",
            "pollCreationMessageV2",
            "pollCreationMessageV3",
            "pollCreationMessageV4",
            "pollCreationMessageV5",
            "pollCreationMessageV6",
        ):
            poll = data.get(key)
            if isinstance(poll, dict):
                return poll
        return None

    @property
    def is_revoked(self) -> bool:
        protocol = self.message_data.get("protocolMessage")
        if not isinstance(protocol, dict):
            return False
        kind = protocol.get("type")
        return kind in ("REVOKE", 0, "0")

    @property
    def reactions(self) -> tuple[JSON, ...]:
        data = self.raw.get("_data")
        if not isinstance(data, dict):
            return ()
        items: list[JSON] = []
        source = data.get("SourceWebMsg")
        for container in (data, source):
            if not isinstance(container, dict):
                continue
            for key in ("reactions", "Reactions"):
                value = container.get(key)
                if isinstance(value, list):
                    items.extend(item for item in value if isinstance(item, dict))
        return tuple(items)

    @property
    def poll_updates(self) -> tuple[JSON, ...]:
        data = self.raw.get("_data")
        if not isinstance(data, dict):
            return ()
        items: list[JSON] = []
        source = data.get("SourceWebMsg")
        for container in (data, source):
            if not isinstance(container, dict):
                continue
            for key in ("pollUpdates", "PollUpdates"):
                value = container.get(key)
                if isinstance(value, list):
                    items.extend(item for item in value if isinstance(item, dict))
        return tuple(items)

    @property
    def date(self) -> date | None:
        timestamp = self.timestamp_ms
        return (
            datetime.fromtimestamp(timestamp / 1000, tz=TZ).date()
            if timestamp is not None
            else None
        )

    @property
    def ack(self) -> int | None:
        return _int_timestamp(self.raw.get("ack"))


class WahaClient:
    def __init__(
        self,
        base_url: str,
        session: str = "default",
        api_key: str | None = None,
        timeout: float = 30.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.session = session
        headers = {"X-Api-Key": api_key} if api_key else {}
        self._client = httpx.Client(
            base_url=self.base_url,
            headers=headers,
            timeout=timeout,
            transport=transport,
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> WahaClient:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def _request(
        self,
        method: str,
        path: str,
        *,
        not_found_ok: bool = False,
        **kwargs: Any,
    ) -> Any:
        response = self._client.request(method, path, **kwargs)
        if response.status_code == 404 and not_found_ok:
            return None
        if response.status_code >= 400:
            detail = response.text[:500].strip()
            raise WahaError(f"{method} {path} -> {response.status_code}: {detail or 'no body'}")
        if response.status_code == 204 or not response.content:
            return None
        return response.json()

    @staticmethod
    def _parse_message_list(payload: Any) -> list[WahaMessage]:
        if isinstance(payload, list):
            return [WahaMessage(item) for item in payload if isinstance(item, dict)]
        if isinstance(payload, dict):
            for key in ("messages", "items", "data"):
                value = payload.get(key)
                if isinstance(value, list):
                    return [WahaMessage(item) for item in value if isinstance(item, dict)]
        return []

    def session_info(self) -> JSON:
        return self._request("GET", f"/api/sessions/{quote(self.session)}") or {}

    def start_session(self) -> None:
        self._request("POST", f"/api/sessions/{quote(self.session)}/start")

    def qr_url(self) -> str:
        return f"{self.base_url}/api/{quote(self.session)}/auth/qr?format=image"

    def wait_until_working(
        self,
        timeout: float = 300.0,
        interval: float = 5.0,
        on_status: Any = None,
    ) -> JSON:
        deadline = time.monotonic() + timeout
        last_status: str | None = None
        while time.monotonic() < deadline:
            info = self.session_info()
            status = info.get("status")
            if status == "WORKING":
                return info
            if status == "FAILED":
                raise WahaError(
                    "WAHA reports the WhatsApp session as FAILED. "
                    "Re-link the device in the WAHA dashboard."
                )
            if status != last_status and on_status is not None:
                on_status(status, info)
                last_status = status
            time.sleep(interval)
        raise WahaError(
            f"WAHA session {self.session} did not become WORKING within "
            f"{int(timeout)}s (last status: {last_status or 'unknown'})."
        )

    def me(self) -> JSON:
        payload = self._request("GET", f"/api/sessions/{quote(self.session)}/me", not_found_ok=True)
        if isinstance(payload, dict):
            return payload
        info = self.session_info()
        me = info.get("me")
        return me if isinstance(me, dict) else {}

    def groups(self, limit: int = 1000) -> list[WahaGroup]:
        payload = self._request(
            "GET",
            f"/api/{quote(self.session)}/groups",
            params={"limit": limit, "offset": 0, "exclude": "participants"},
        )
        if isinstance(payload, dict):
            for key in ("groups", "items", "data"):
                value = payload.get(key)
                if isinstance(value, list):
                    payload = value
                    break
        if not isinstance(payload, list):
            return []
        groups: dict[str, WahaGroup] = {}
        for item in payload:
            if not isinstance(item, dict):
                continue
            group_id = item.get("id")
            if not isinstance(group_id, str) or not group_id:
                continue
            name = item.get("subject") or item.get("name") or "Unnamed group"
            groups[group_id] = WahaGroup(id=group_id, name=str(name))
        return sorted(groups.values(), key=lambda group: (group.name.casefold(), group.id))

    def messages(self, chat_id: str, start_ms: int, end_ms: int) -> list[WahaMessage]:
        messages: list[WahaMessage] = []
        offset = 0
        limit = 100
        while offset < 20_000:
            payload = self._request(
                "GET",
                f"/api/{quote(self.session)}/chats/{quote(chat_id, safe='')}/messages",
                params={
                    "limit": limit,
                    "offset": offset,
                    "sortBy": "timestamp",
                    "sortOrder": "asc",
                    "filter.timestamp.gte": start_ms // 1000,
                    "filter.timestamp.lte": (end_ms - 1) // 1000,
                    "merge": "true",
                },
            )
            page = self._parse_message_list(payload)
            messages.extend(page)
            if len(page) < limit:
                break
            offset += limit
        return messages

    def messages_before(self, chat_id: str, before_ms: int) -> list[WahaMessage]:
        payload = self._request(
            "GET",
            f"/api/{quote(self.session)}/chats/{quote(chat_id, safe='')}/messages",
            params={
                "limit": 1,
                "offset": 0,
                "sortBy": "timestamp",
                "sortOrder": "desc",
                "filter.timestamp.lte": (before_ms - 1) // 1000,
                "merge": "true",
            },
        )
        return self._parse_message_list(payload)

    def send_text(self, chat_id: str, text: str) -> JSON:
        payload = self._request(
            "POST",
            "/api/sendText",
            json={
                "session": self.session,
                "chatId": chat_id,
                "text": text,
                "linkPreview": False,
            },
        )
        return payload if isinstance(payload, dict) else {}

    def message(self, chat_id: str, message_id: str) -> JSON:
        payload = self._request(
            "GET",
            f"/api/{quote(self.session)}/chats/{quote(chat_id, safe='')}/messages/"
            f"{quote(message_id, safe='')}",
            not_found_ok=True,
        )
        return payload if isinstance(payload, dict) else {}

    def lid_for_phone(self, digits: str) -> str | None:
        payload = self._request(
            "GET",
            f"/api/{quote(self.session)}/lids/pn/{quote(digits, safe='')}",
            not_found_ok=True,
        )
        if isinstance(payload, dict):
            lid = payload.get("lid")
            return lid if isinstance(lid, str) and lid else None
        return None

    def phone_for_lid(self, lid: str) -> str | None:
        payload = self._request(
            "GET",
            f"/api/{quote(self.session)}/lids/{quote(lid, safe='')}",
            not_found_ok=True,
        )
        if isinstance(payload, dict):
            phone = payload.get("pn")
            return phone if isinstance(phone, str) and phone else None
        return None

    def contact(self, chat_id: str) -> JSON | None:
        payload = self._request(
            "GET",
            f"/api/{quote(self.session)}/contacts/{quote(chat_id, safe='')}",
            not_found_ok=True,
        )
        return payload if isinstance(payload, dict) else None
