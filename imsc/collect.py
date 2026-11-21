from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from .config import AppConfig
from .report import ActivityItem, format_activity_date
from .schedule import WeeklyWindow
from .store import EventStore
from .utils import phone_digits
from .waha import WahaClient, WahaError, WahaMessage

TITLE_PATTERN = re.compile(r"\*([^*]+)\*")
WEEKLY_PATTERN = re.compile(r"\bweekly\b", re.IGNORECASE)


class CollectionError(RuntimeError):
    pass


@dataclass(frozen=True)
class Marker:
    marker_timestamp_ms: int
    following: WahaMessage
    recovered_after_revoked: bool


@dataclass(frozen=True)
class CollectionResult:
    items: tuple[ActivityItem, ...]
    warnings: tuple[str, ...]


@dataclass(frozen=True)
class Identity:
    display: str | None
    phone: str | None


def _normalized_text(message: WahaMessage) -> str:
    return " ".join(message.body.split())


def is_weekly_title(message: WahaMessage) -> bool:
    match = TITLE_PATTERN.search(_normalized_text(message))
    return bool(match and WEEKLY_PATTERN.search(match.group(1)))


def discover_markers(
    messages: list[WahaMessage] | tuple[WahaMessage, ...],
    start_ms: int,
    end_ms: int,
) -> list[Marker]:
    ordered = sorted(
        (message for message in messages if message.timestamp_ms is not None and message.id),
        key=lambda message: (message.timestamp_ms or 0, message.id or ""),
    )
    markers: list[Marker] = []
    for index, marker in enumerate(ordered):
        if not is_weekly_title(marker):
            continue
        following = ordered[index + 1] if index + 1 < len(ordered) else None
        # If the next post is already the following week's title, this week had
        # no engagement post; the title belongs to the next week.
        if following is not None and is_weekly_title(following):
            continue
        recovered = False
        if following is not None and following.is_revoked:
            marker_date = marker.date
            for candidate in ordered[index + 2 :]:
                if candidate.date != marker_date or is_weekly_title(candidate):
                    break
                if not candidate.is_revoked:
                    following = candidate
                    recovered = True
                    break
        if following is None or following.timestamp_ms is None:
            continue
        if not (start_ms <= following.timestamp_ms < end_ms):
            continue
        markers.append(
            Marker(
                marker_timestamp_ms=marker.timestamp_ms or 0,
                following=following,
                recovered_after_revoked=recovered,
            )
        )
    return markers


def _key_value(key: Any, *names: str) -> str | None:
    if not isinstance(key, dict):
        return None
    for name in names:
        value = key.get(name)
        if isinstance(value, str) and value:
            return value
    return None


def poll_update_voters(updates: tuple[dict[str, Any], ...], me_id: str | None) -> set[str]:
    voters: set[str] = set()
    for update in updates:
        key = update.get("pollUpdateMessageKey") or update.get("key") or update
        if isinstance(key, dict) and key.get("fromMe") is True:
            if me_id:
                voters.add(me_id)
            continue
        voter = _key_value(
            key, "participant", "participantAlt", "remoteJid", "remoteJidAlt"
        ) or _key_value(update, "participant", "from", "sender")
        if voter:
            voters.add(voter)
    return voters


def reaction_sender(reaction: dict[str, Any], me_id: str | None) -> str | None:
    key = reaction.get("key")
    if isinstance(key, dict) and key.get("fromMe") is True:
        return me_id
    return _key_value(
        key, "participant", "participantAlt", "remoteJid", "remoteJidAlt"
    ) or _key_value(reaction, "senderId", "sender", "participant", "participantAlt", "from")


def _strip_device(jid: str) -> str:
    user, separator, server = jid.partition("@")
    if not separator:
        return jid
    return f"{user.split(':')[0]}@{server}"


def _identity_from_contact(contact: dict[str, Any] | None, pn: str | None) -> Identity:
    contact = contact or {}
    username = contact.get("username")
    number = contact.get("number") or contact.get("phoneNumber") or contact.get("phone") or pn
    identifier = contact.get("id")
    if (
        number is None
        and isinstance(identifier, str)
        and (identifier.endswith("@c.us") or identifier.endswith("@s.whatsapp.net"))
    ):
        number = identifier
    name = (
        contact.get("pushname")
        or contact.get("pushName")
        or contact.get("name")
        or contact.get("shortName")
        or contact.get("fullName")
    )
    phone = phone_digits(str(number)) if number is not None else None
    if username is not None:
        cleaned = str(username).strip().lstrip("@")
        if cleaned:
            return Identity(display=f"@{cleaned}", phone=phone)
    if phone:
        return Identity(display=f"+{phone}", phone=phone)
    if name is not None:
        cleaned = " ".join(str(name).split())
        if cleaned:
            return Identity(display=cleaned, phone=None)
    return Identity(display=None, phone=phone)


def resolve_identity(
    waha: WahaClient,
    sender_id: str | None,
    me_id: str | None,
    cache: dict[str, Identity],
) -> Identity | None:
    if not sender_id:
        return None
    if sender_id == me_id and me_id is not None:
        jid = me_id
    else:
        jid = _strip_device(sender_id)
    if jid.endswith("@s.whatsapp.net"):
        jid = jid.replace("@s.whatsapp.net", "@c.us")
    cached = cache.get(jid)
    if cached is not None:
        return cached

    pn: str | None = None
    if jid.endswith("@lid"):
        try:
            pn = waha.phone_for_lid(jid)
        except WahaError:
            pn = None
    try:
        contact = waha.contact(jid)
    except WahaError:
        contact = None
    if pn:
        try:
            pn_contact = waha.contact(pn)
        except WahaError:
            pn_contact = None
        if pn_contact:
            merged = dict(pn_contact)
            if contact:
                merged.update({key: value for key, value in contact.items() if value})
            contact = merged
    identity = _identity_from_contact(contact, pn)
    cache[jid] = identity
    return identity


def resolve_displays(
    waha: WahaClient,
    sender_ids: list[str],
    me_id: str | None,
    cache: dict[str, Identity],
    ignored_phone_numbers: tuple[str, ...],
) -> tuple[list[str], int]:
    ignored = set(ignored_phone_numbers)
    displays: dict[str, None] = {}
    unresolved = 0
    for sender_id in dict.fromkeys(sender_ids):
        identity = resolve_identity(waha, sender_id, me_id, cache)
        if identity is None:
            unresolved += 1
            continue
        if identity.phone and identity.phone in ignored:
            continue
        if identity.display is None:
            unresolved += 1
            continue
        displays.setdefault(identity.display, None)
    return sorted(displays, key=str.casefold), unresolved


def _iso(timestamp_ms: int) -> str:
    return datetime.fromtimestamp(timestamp_ms / 1000, tz=UTC).isoformat().replace("+00:00", "Z")


def collect_engagement(
    waha: WahaClient,
    config: AppConfig,
    store: EventStore,
    window: WeeklyWindow,
    me_id: str | None,
    *,
    strict: bool = True,
) -> CollectionResult:
    chat_id = config.selected_chat.id
    warnings: list[str] = []

    oldest = waha.oldest_message(chat_id)
    if oldest is None or oldest.timestamp_ms is None:
        message = (
            f"The WhatsApp chat {chat_id} has no stored messages; "
            "cannot verify that history reaches the report start."
        )
        if strict:
            raise CollectionError(message)
        warnings.append("History may not reach the start of the current month.")
    elif oldest.timestamp_ms > window.start_ms:
        message = (
            f"WhatsApp's stored history for {chat_id} starts "
            f"{_iso(oldest.timestamp_ms)} and does not reach the report start "
            f"{_iso(window.start_ms)}; refusing to send an incomplete report. "
            "Wait for WAHA to finish syncing and retry."
        )
        if strict:
            raise CollectionError(message)
        warnings.append("History may not reach the start of the current month.")

    messages = waha.messages(chat_id, window.start_ms, window.end_ms)
    markers = discover_markers(messages, window.start_ms, window.end_ms)
    items: list[ActivityItem] = []
    identity_cache: dict[str, Identity] = {}

    for marker in markers:
        following = marker.following
        timestamp_ms = following.timestamp_ms
        if timestamp_ms is None:
            continue
        item_date = format_activity_date(timestamp_ms)
        if following.is_poll:
            poll_id = following.id
            votes = store.poll_voters(poll_id) if poll_id else []
            updates = following.poll_updates
            live_voters = {vote.voter_id for vote in votes}
            stored_voters = poll_update_voters(updates, me_id)
            captured = list(dict.fromkeys([*live_voters, *stored_voters]))
            if updates and not captured:
                message = (
                    f"{item_date}: the poll has {len(updates)} encrypted vote "
                    "record(s) but no recoverable voter identities; refusing to "
                    "send an incomplete report."
                )
                if strict:
                    raise CollectionError(message)
                warnings.append(message)
                continue
            missing_from_ingester = stored_voters - live_voters
            if missing_from_ingester:
                warnings.append(
                    f"{item_date}: {len(missing_from_ingester)} poll voter(s) "
                    "came from stored poll updates, not the live ingester."
                )
            activity = 2
            kind = "poll"
        else:
            captured = []
            for reaction in following.reactions:
                sender = reaction_sender(reaction, me_id)
                if sender:
                    captured.append(sender)
            if following.id:
                captured.extend(
                    sender.reactor_id for sender in store.reaction_senders(following.id)
                )
            activity = 1
            kind = "reaction"

        displays, unresolved = resolve_displays(
            waha,
            captured,
            me_id,
            identity_cache,
            config.ignored_phone_numbers,
        )
        items.append(
            ActivityItem(
                timestamp_ms=timestamp_ms,
                activity=activity,
                participant_displays=tuple(displays),
            )
        )
        if unresolved:
            warnings.append(
                f"{item_date}: {unresolved} {kind} participant identities are unavailable."
            )
        if marker.recovered_after_revoked:
            warnings.append(f"{item_date}: uses a same-day replacement after a revoked item.")

    return CollectionResult(items=tuple(items), warnings=tuple(warnings))
