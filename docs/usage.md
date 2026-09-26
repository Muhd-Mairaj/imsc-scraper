# Usage

## Help

`bun run dev --help` (or `-h`) prints the commands and options and exits without starting WhatsApp. In Docker, use `docker compose run --rm imsc --help`.

## Configuration

`bun run dev setup` links WhatsApp and writes `data/config.json`:

- Scan the QR code from **WhatsApp > Linked devices > Link a device** on the first run.
- Choose the Community announcements group.
- Enter ignored admin phone numbers in international format, one per line; a blank line finishes the list.
- Enter the weekly report recipient, or leave it blank to skip weekly reports.

Phone numbers are normalized to digits (`+60 12-345 6789` → `60123456789`). Re-run `setup` to change any of it. The session, configuration, and output all live under the ignored `data/` directory — keep it private and backed up.

## Monthly summary

`bun run dev` (the default `verify` command) prints the current month's activity and writes the same text to `data/monthly-YYYY-MM.txt`.

- Poll votes count as `2`, reactions as `1`.
- Ignored admin phone numbers are excluded.
- A date with no eligible participants still gets its heading.
- Missing history, engagement, or identity data produces an explicit warning instead of being treated as zero.

## Weekly report

`bun run dev weekly` sends the recipient the seven complete local days ending at the most recent Saturday 00:00 `Asia/Kuala_Lumpur`. The week is anchored to that boundary rather than to the run time, so a catch-up run still reports the correct week.

Every script-sent message starts with `[AUTO MESSAGE]` and ends with `_~ Mairaj's Bot_`.

- An empty week notifies both the recipient and your own number.
- A failure alerts your own number (best effort) and exits non-zero so the scheduler records it.
- Sends are idempotent per window; the last sent window is recorded in `data/weekly-state.json`.
- `--force` re-sends the current window (report and failure alert).
- `--dry-run` prints the exact message without sending or saving state.

Both the recipient and your own number are resolved to their current WhatsApp id (LID) before sending, and a send is only counted once the message leaves the device.

## Logs

Every run appends timestamped, levelled lines to `data/logs/imsc-YYYY-MM-DD.log` (UTC) and mirrors them to the terminal. Each line records the command and runtime, the WhatsApp lifecycle (initialising, ready, authenticated, QR), collection counts and warnings, send/acknowledgement outcomes, and any failure's stack trace. The newest 30 files are kept.
