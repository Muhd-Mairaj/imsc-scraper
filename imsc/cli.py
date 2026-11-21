from __future__ import annotations

import json
import os
import platform
import sys
import time
import traceback
from dataclasses import dataclass
from datetime import datetime

import httpx

from .collect import CollectionError, collect_engagement
from .config import (
    AppConfig,
    ConfigError,
    SelectedChat,
    config_file_path,
    events_database_path,
    load_config,
    monthly_summary_file_path,
    save_config,
)
from .logging import Logger, create_logger, prune_log_files
from .report import render_monthly_activity_summary
from .run import (
    ReportDependencies,
    run_month_end_report,
    run_weekly_report,
)
from .schedule import (
    WeeklyWindow,
    compute_month_end_window,
    parse_report_week,
)
from .state import load_weekly_state, save_weekly_state
from .store import EventStore
from .utils import describe_ack, phone_digits, utc_now
from .waha import WahaClient, WahaError, WahaMessage

COMMANDS = {"setup", "verify", "weekly", "month-end", "ingest", "status", "help"}

USAGE = """Usage: imsc <command> [options]

Commands:
  verify      Write the current month's engagement summary (default)
  setup       Choose the WhatsApp group and weekly recipient
  weekly      Send the weekly engagement report
  month-end   Send the days since the last report up to the month end
  ingest      Run the WAHA event ingester
  status      Show the WAHA session, selected group, and event store
  help        Show this help

Options:
  --force     weekly, month-end: send even if this window was already recorded
  --dry-run   weekly, month-end: print the report without sending or saving state
  --week      weekly: report the week ending on this Saturday (YYYY-MM-DD)
  -h, --help  Show this help
"""


@dataclass(frozen=True)
class CommandArguments:
    command: str
    force: bool
    dry_run: bool
    week: str | None = None


def parse_args(arguments: list[str] | tuple[str, ...]) -> CommandArguments:
    argv = list(arguments)
    if "--help" in argv or "-h" in argv:
        return CommandArguments("help", False, False)

    force = "--force" in argv
    dry_run = "--dry-run" in argv
    week: str | None = None
    positionals: list[str] = []
    index = 0
    while index < len(argv):
        argument = argv[index]
        if argument == "--week":
            if index + 1 >= len(argv):
                raise ValueError("--week requires a date (YYYY-MM-DD).")
            week = argv[index + 1]
            index += 2
            continue
        if argument.startswith("--week="):
            week = argument.split("=", 1)[1]
            index += 1
            continue
        if argument in ("--force", "--dry-run"):
            index += 1
            continue
        if argument.startswith("-"):
            index += 1
            continue
        positionals.append(argument)
        index += 1

    command = positionals[0] if positionals and positionals[0] in COMMANDS else "verify"
    if command not in ("weekly", "month-end") and (force or dry_run):
        raise ValueError(
            f"{'--force' if force else '--dry-run'} is only supported by the "
            "weekly and month-end commands."
        )
    if week is not None and command != "weekly":
        raise ValueError("--week is only supported by the weekly command.")
    return CommandArguments(command, force, dry_run, week)


def _waha_client() -> WahaClient:
    return WahaClient(
        base_url=os.environ.get("WAHA_URL", "http://localhost:3000"),
        session=os.environ.get("WAHA_SESSION", "default"),
        api_key=os.environ.get("WAHA_API_KEY"),
        timeout=float(os.environ.get("WAHA_TIMEOUT", "30")),
    )


def _public_url(waha: WahaClient) -> str:
    return os.environ.get("WAHA_PUBLIC_URL", waha.base_url).rstrip("/")


def _on_waha_status(status: str | None, _info: dict[str, object], waha: WahaClient) -> None:
    if status == "SCAN_QR_CODE":
        print(
            "WAHA is waiting for a linked-device scan.\n"
            f"Open {_public_url(waha)} (or the WAHA dashboard) and scan the QR code."
        )
    else:
        print(f"WAHA session status: {status or 'unknown'}")


def _wait_for_waha(waha: WahaClient, logger: Logger) -> dict[str, object]:
    info = waha.session_info()
    status = info.get("status")
    logger.info(f"WAHA session {waha.session} is {status or 'unknown'}.")
    if status in (None, "STOPPED", "FAILED"):
        try:
            waha.start_session()
        except WahaError as error:
            logger.warn(f"Could not start the WAHA session: {error}")
    if status == "SCAN_QR_CODE":
        _on_waha_status(status, info, waha)
    try:
        info = waha.wait_until_working(
            timeout=float(os.environ.get("WAHA_READY_TIMEOUT", "600")),
            on_status=lambda session_status, payload: _on_waha_status(
                session_status, payload, waha
            ),
        )
    except WahaError:
        logger.error(
            "WAHA is not ready. Pair the session in the WAHA dashboard "
            f"(open {_public_url(waha)}) and retry."
        )
        raise
    logger.info("WAHA session is WORKING.")
    return info


def _send_message(waha: WahaClient, chat_id: str, content: str, logger: Logger) -> None:
    sent = WahaMessage(waha.send_text(chat_id, content))
    message_id = sent.id
    if message_id is None:
        raise WahaError(f"WAHA did not return a message id for the send to {chat_id}.")
    ack = sent.ack
    logger.info(
        f"WhatsApp accepted message {message_id} for {chat_id} (ack={ack}: {describe_ack(ack)})."
    )
    deadline = time.monotonic() + float(os.environ.get("WAHA_ACK_TIMEOUT", "60"))
    while (ack is None or ack < 1) and time.monotonic() < deadline:
        time.sleep(1)
        current = WahaMessage(waha.message(chat_id, message_id))
        if current.ack is not None:
            ack = current.ack
    if ack is None or ack < 1:
        raise WahaError(
            f"WhatsApp left message {message_id} to {chat_id} pending "
            f"(ack={ack}: {describe_ack(ack)}); it was not sent."
        )
    logger.info(f"Message {message_id} settled at ack={ack} ({describe_ack(ack)}).")


def _me_id(waha: WahaClient) -> tuple[str | None, str | None]:
    me = waha.me()
    chat_id = me.get("id") if isinstance(me.get("id"), str) else None
    lid = me.get("lid") if isinstance(me.get("lid"), str) else None
    return chat_id, lid


def _ensure_ingester() -> None:
    """A report needs the live event store; refuse to run without it."""
    url = os.environ.get("IMSC_INGEST_URL")
    if not url:
        return
    try:
        response = httpx.get(f"{url.rstrip('/')}/health", timeout=5)
        response.raise_for_status()
    except Exception as error:
        raise CollectionError(
            f"The WAHA event ingester at {url} is not reachable ({error}); "
            "refusing to send an incomplete report."
        ) from error


def run_scheduled_report(
    command: str, force: bool, dry_run: bool, now: datetime, logger: Logger
) -> None:
    config = load_config()
    recipient = config.weekly_report_recipient
    if recipient is None:
        raise ConfigError("No weekly report recipient is configured. Run `imsc setup` again.")
    waha = _waha_client()
    try:
        _wait_for_waha(waha, logger)
        me_chat_id, me_lid = _me_id(waha)
        if me_chat_id is None and me_lid is None:
            raise WahaError("WAHA did not report the linked account's id.")
        self_chat_id = me_lid or me_chat_id
        recipient_chat_id = waha.lid_for_phone(recipient) or f"{recipient}@c.us"
        state = load_weekly_state()
        store = EventStore(events_database_path())
        store.init()
        logger.info(
            f"{command} run starting: recipient={recipient_chat_id}, "
            f"self={self_chat_id}, force={force}, dryRun={dry_run}."
        )

        def collect(window: WeeklyWindow):
            _ensure_ingester()
            return collect_engagement(
                waha, config, store, window, me_lid or me_chat_id, strict=True
            )

        def send(chat_id: str, content: str) -> None:
            _send_message(waha, chat_id, content, logger)

        dependencies = ReportDependencies(
            now=now,
            collect=collect,
            send_message=send,
            recipient_chat_id=recipient_chat_id,
            self_chat_id=self_chat_id,
            force=force,
            dry_run=dry_run,
            state=state,
            save_state=save_weekly_state,
            log=logger.info,
        )
        outcome = (
            run_weekly_report(dependencies)
            if command == "weekly"
            else run_month_end_report(dependencies)
        )
        logger.info(
            f"Command {command!r} finished with status={outcome.status} "
            f"emptyWeek={outcome.empty_week}."
        )
    finally:
        waha.close()


def run_setup(logger: Logger) -> None:
    waha = _waha_client()
    try:
        _wait_for_waha(waha, logger)
        groups = waha.groups()
        if not groups:
            raise WahaError("No WhatsApp groups were found for this account.")
        print("Choose the Community announcements group:")
        for index, group in enumerate(groups, start=1):
            print(f"  {index}. {group.name} ({group.id})")
        while True:
            answer = input("Group number: ").strip()
            try:
                choice = int(answer)
            except ValueError:
                print("Enter a number from the list.")
                continue
            if 1 <= choice <= len(groups):
                selected = groups[choice - 1]
                break
            print("Enter a number from the list.")

        ignored: list[str] = []
        print("Enter ignored admin phone numbers in international format, one per line.")
        while True:
            value = input("Ignored phone number (blank to finish): ").strip()
            if not value:
                break
            ignored.append(value)
        recipient = (
            phone_digits(input("Weekly report recipient in international format (blank to skip): "))
            or None
        )
        config = AppConfig(
            selected_chat=SelectedChat(id=selected.id, name=selected.name),
            ignored_phone_numbers=tuple(ignored),
            weekly_report_recipient=recipient,
        )
        save_config(config)
        logger.info(
            f'Saved configuration: group "{selected.name}" ({selected.id}), '
            f"{len(ignored)} ignored number(s), weekly recipient "
            f"{recipient or 'unset'}."
        )
        print(f'Saved "{selected.name}" to {config_file_path()}')
    finally:
        waha.close()


def run_verify(logger: Logger) -> None:
    config = load_config()
    waha = _waha_client()
    try:
        _wait_for_waha(waha, logger)
        me_chat_id, me_lid = _me_id(waha)
        store = EventStore(events_database_path())
        store.init()
        now = utc_now()
        month_start_ms = compute_month_end_window(now, None).end_ms
        window = WeeklyWindow(start_ms=month_start_ms, end_ms=int(now.timestamp() * 1000))
        logger.info(
            f'Monthly summary for chat "{config.selected_chat.name}" ({config.selected_chat.id}).'
        )
        collected = collect_engagement(
            waha, config, store, window, me_lid or me_chat_id, strict=False
        )
        summary = render_monthly_activity_summary(list(collected.items), list(collected.warnings))
        sys.stdout.write(summary)
        path = monthly_summary_file_path(now)
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        path.write_text(summary, encoding="utf-8")
        path.chmod(0o600)
        logger.info(
            f"Monthly summary: {len(collected.items)} item(s), "
            f"{len(collected.warnings)} warning(s), written to {path}."
        )
    finally:
        waha.close()


def run_status(logger: Logger) -> None:
    waha = _waha_client()
    try:
        info = waha.session_info()
        me_chat_id, me_lid = _me_id(waha)
        print(f"WAHA URL: {waha.base_url}")
        print(f"Session:  {waha.session} ({info.get('status', 'unknown')})")
        print(f"Account:  {me_chat_id or me_lid or 'unknown'}")
        try:
            config = load_config()
            print(f"Group:    {config.selected_chat.name} ({config.selected_chat.id})")
            print(f"Recipient: {config.weekly_report_recipient or 'unset'}")
        except ConfigError as error:
            print(f"Config:   {error}")
        store = EventStore(events_database_path())
        store.init()
        print(f"Events:   {store.counts()}")
    finally:
        waha.close()


def run_ingest() -> None:
    from .ingest import run_ingest as start

    start()


def main(argv: list[str] | None = None) -> None:
    arguments = sys.argv[1:] if argv is None else argv
    try:
        parsed = parse_args(arguments)
    except ValueError as error:
        print(error, file=sys.stderr)
        raise SystemExit(2) from error

    if parsed.command == "help":
        sys.stdout.write(USAGE)
        return

    now = utc_now()
    if parsed.week:
        try:
            now = parse_report_week(parsed.week)
        except ValueError as error:
            print(error, file=sys.stderr)
            raise SystemExit(2) from error

    logger = create_logger(parsed.command)
    prune_log_files()
    logger.info(f'Starting "{parsed.command}" with args {json.dumps(arguments)}.')
    logger.info(
        f"Runtime: python={platform.python_version()} pid={os.getpid()} "
        f"cwd={os.getcwd()} timeZone={datetime.now().astimezone().tzname()}."
    )

    try:
        if parsed.command == "ingest":
            run_ingest()
        elif parsed.command == "setup":
            run_setup(logger)
        elif parsed.command in ("weekly", "month-end"):
            run_scheduled_report(parsed.command, parsed.force, parsed.dry_run, now, logger)
        elif parsed.command == "status":
            run_status(logger)
        else:
            run_verify(logger)
        logger.info(f'Command "{parsed.command}" completed successfully.')
    except (CollectionError, ConfigError, WahaError) as error:
        logger.error(f'Command "{parsed.command}" failed: {error}')
        print(error, file=sys.stderr)
        raise SystemExit(1) from error
    except Exception as error:
        logger.error(f'Command "{parsed.command}" failed: {traceback.format_exc()}')
        print(error, file=sys.stderr)
        raise SystemExit(1) from error


__all__ = [
    "CommandArguments",
    "USAGE",
    "main",
    "parse_args",
    "run_scheduled_report",
    "run_setup",
    "run_status",
    "run_verify",
]
