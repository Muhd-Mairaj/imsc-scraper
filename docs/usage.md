# Usage

## Commands

| Command | What it does |
|---|---|
| `imsc setup` | Lists groups, saves the selected group, ignored numbers, and weekly recipient to `data/config.json`. |
| `imsc weekly` | Sends the most recent completed week. |
| `imsc weekly --dry-run` | Collects and prints the report without sending or saving state. |
| `imsc weekly --force` | Sends even if the window is already recorded. |
| `imsc weekly --week YYYY-MM-DD` | Reports the week ending on that Saturday, for backfills. |
| `imsc month-end` | Sends the days since the last report up to the current month start. |
| `imsc verify` | Writes the current month's summary to `data/monthly-YYYY-MM.txt`. |
| `imsc ingest` | Runs the WAHA webhook receiver that stores poll votes and reactions. |
| `imsc status` | Prints the WAHA session, account, group, recipient, and event counts. |
| `imsc help` | Prints usage. |

`--force` and `--dry-run` are accepted by `weekly` and `month-end` only.
`--week` is accepted by `weekly` only.

## Windows

All boundaries are in `Asia/Kuala_Lumpur` (UTC+8, no DST).

- **Weekly:** the seven complete days ending at the most recent Saturday
  `00:00`. Running on Saturday at 06:00, on Monday, or on the following Friday
  all target the same completed week.
- **Month-end:** from the later of the last weekly report and the previous
  month start, up to the current month start. A long gap still produces at most
  one month.
- **Verify:** from the current month start to now.

`--week 2026-11-14` treats 14 November as the Saturday that ends the week, so
the report covers 7–13 November. Backfills do not move the recorded state
backwards; use `--force` to resend a window.

## Report format

```text
[AUTO MESSAGE]
*Weekly engagement report*
14/11/2026 – 20/11/2026

*16/11/2026*
@HasanHisham17 - 2
+601162168427 - 2

*19/11/2026*
@rf9410 - 2

_~ Mairaj's Bot_
```

- `2` means the participant voted in that day’s poll.
- `1` means the participant reacted to that day’s post.
- A participant with a WhatsApp username appears as `@username`; otherwise the
  resolved phone number is `+digits`. If neither is available, the name is used;
  if nothing resolves, a warning names the day.
- `ignoredPhoneNumbers` in `data/config.json` removes admins from the tally by
  resolved phone number.

## Fail-closed rules

The run refuses to send and alerts the operator when:

- WAHA has no stored messages for the group, or its oldest stored message is
  after the report start.
- A weekly post is a poll, WhatsApp reports encrypted vote records, and the
  ingester has no decrypted votes for that poll (usually because
  `imsc-ingest` was down).
- A poll has more distinct encrypted voters than the ingester captured.

`imsc verify` is deliberately lenient: it warns about incomplete history but
still writes the local summary.

## State

`data/weekly-state.json` is shared with the previous implementation:

```json
{
  "lastReportWindowEnd": 1795190400000,
  "lastAlertWindowEnd": 1793376000000,
  "lastMonthEndWindowEnd": 1793462400000
}
```

- `lastReportWindowEnd` — last weekly window end (milliseconds).
- `lastAlertWindowEnd` — last window that already produced a failure alert.
- `lastMonthEndWindowEnd` — last month-end window end.

The state is written atomically with mode `0600`.

## Environment

| Variable | Default | Used by |
|---|---|---|
| `WAHA_URL` | `http://localhost:3000` | report |
| `WAHA_SESSION` | `default` | report |
| `WAHA_API_KEY` | unset | report (required when WAHA has a key) |
| `WAHA_READY_TIMEOUT` | `600` | report (seconds to wait for `WORKING`) |
| `WAHA_ACK_TIMEOUT` | `60` | report (seconds to wait for `ack >= 1`) |
| `IMSC_DATA_DIR` | `data` | all commands |
| `IMSC_INGEST_HOST` | `0.0.0.0` | ingest |
| `IMSC_INGEST_PORT` | `8000` | ingest |
| `IMSC_INGEST_URL` | unset | report (set to `http://imsc-ingest:8000` in compose) |

## Ingester

WAHA sends `poll.vote` and `message.reaction` webhooks to
`http://imsc-ingest:8000/webhook`. Each event is upserted into
`data/waha-events.sqlite3`:

- `poll_votes(poll_id, voter_id, selected_options, timestamp_ms)`
- `reactions(message_id, reactor_id, emoji, timestamp_ms)`

A voter changing or clearing a vote replaces/removes the row. Duplicate webhook
deliveries are idempotent. `GET /health` reports the row counts.

The ingester is not optional: WhatsApp exposes poll voters only as live events.
If it is down during a vote, the report fails closed rather than under-reporting.

## Logs

`data/logs/imsc-YYYY-MM-DD.log` uses UTC timestamps and keeps the newest 30
files. Every run also mirrors to stdout/stderr for `docker compose logs`.
