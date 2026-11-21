from __future__ import annotations

from datetime import UTC, datetime


def error_message(error: object) -> str:
    return str(error)


def phone_digits(value: str) -> str:
    """Digits only, so ``+60 12-345 6789`` and ``60123456789`` compare equal."""
    return "".join(character for character in value if character.isdigit())


def describe_ack(ack: int | None) -> str:
    return {
        -1: "error",
        0: "pending",
        1: "sent to WhatsApp",
        2: "delivered",
        3: "read",
        4: "played",
    }.get(ack, f"unknown ({ack})")


def utc_now() -> datetime:
    return datetime.now(UTC)


def iso_z(value: datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
