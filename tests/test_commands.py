from imsc.cli import CommandArguments, parse_args


def test_defaults_to_the_monthly_verify_command():
    assert parse_args([]) == CommandArguments("verify", False, False, None)
    assert parse_args(["unexpected"]) == CommandArguments("verify", False, False, None)


def test_recognizes_setup_and_weekly():
    assert parse_args(["setup"]) == CommandArguments("setup", False, False, None)
    assert parse_args(["weekly"]) == CommandArguments("weekly", False, False, None)


def test_recognizes_month_end_and_its_flags():
    assert parse_args(["month-end", "--force"]) == CommandArguments("month-end", True, False, None)
    assert parse_args(["month-end", "--dry-run"]) == CommandArguments(
        "month-end", False, True, None
    )


def test_weekly_accepts_force_in_any_position():
    assert parse_args(["weekly", "--force"]) == CommandArguments("weekly", True, False, None)
    assert parse_args(["--force", "weekly"]) == CommandArguments("weekly", True, False, None)


def test_weekly_accepts_dry_run_alone_and_with_force():
    assert parse_args(["weekly", "--dry-run"]) == CommandArguments("weekly", False, True, None)
    assert parse_args(["weekly", "--force", "--dry-run"]) == CommandArguments(
        "weekly", True, True, None
    )


def test_weekly_accepts_a_backfill_week():
    assert parse_args(["weekly", "--week", "2026-11-14"]) == CommandArguments(
        "weekly", False, False, "2026-11-14"
    )


def test_flags_are_rejected_for_commands_that_do_not_send():
    for arguments, expected in (
        (["setup", "--force"], "--force"),
        (["--force"], "--force"),
        (["setup", "--dry-run"], "--dry-run"),
        (["--dry-run"], "--dry-run"),
        (["month-end", "--week", "2026-11-14"], "--week"),
    ):
        try:
            parse_args(arguments)
        except ValueError as error:
            assert expected in str(error)
        else:
            raise AssertionError(f"{arguments} should have been rejected")


def test_help_and_short_help_request_usage():
    assert parse_args(["--help"]) == CommandArguments("help", False, False, None)
    assert parse_args(["-h"]) == CommandArguments("help", False, False, None)
    assert parse_args(["weekly", "--help"]) == CommandArguments("help", False, False, None)


def test_help_wins_over_an_invalid_flag():
    assert parse_args(["setup", "--force", "--help"]) == CommandArguments(
        "help", False, False, None
    )
