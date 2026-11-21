# imsc-scraper

Weekly WhatsApp engagement report for the IMSC Community announcements group.

The report reads a week of group messages through **WAHA's GOWS engine**
(whatsmeow in Go, no browser), finds the weekly engagement post, tallies poll
voters and reaction senders, and sends a text report to the configured
recipient.

## How it works

- **WAHA GOWS** holds the linked WhatsApp session and message store.
- **imsc-ingest** receives `poll.vote` and `message.reaction` webhooks and
  writes them to SQLite. WhatsApp only exposes poll voters as live events, so
  this service must stay running.
- **imsc** reads the report window from WAHA's store, joins it with the event
  database, renders the report, sends it, and waits for a delivery ack.

There is no Chromium and no WhatsApp Web page to wait for.

## Quick start

```sh
mkdir -p data
cp .env.example .env
# set WAHA_API_KEY in .env

docker compose up -d waha imsc-ingest
# Open http://localhost:3000 through an SSH tunnel and scan the QR code
# (WhatsApp > Linked devices).

docker compose --profile tools run --rm imsc-report setup
docker compose --profile tools run --rm imsc-report weekly --dry-run
docker compose --profile tools run --rm imsc-report weekly
```

The first WAHA pairing is a one-time re-link; the old whatsapp-web.js session
cannot be reused.

## Commands

```sh
imsc setup                         # choose the group and weekly recipient
imsc weekly                        # send the weekly report
imsc weekly --dry-run              # print it without sending or saving state
imsc weekly --force                # resend an already-recorded week
imsc weekly --week 2026-11-14      # backfill the week ending on that Saturday
imsc month-end                     # send the days since the last report
imsc verify                        # write the current month's summary locally
imsc ingest                        # run the WAHA webhook ingester
imsc status                        # show session, group, and event counts
```

## Weekly window

The weekly report covers the seven complete days ending at the most recent
Saturday 00:00 `Asia/Kuala_Lumpur`. A catch-up run on Monday reports the same
week it would have on Saturday. The first report of a month therefore ends on a
Saturday, and `month-end` fills the gap from the last report to the first of the
month.

`--week YYYY-MM-DD` treats that date as the Saturday that ends the week, for
backfills. The recorded state never moves backwards.

## Safety

- **Fail closed:** if WAHA's stored history does not reach the report start, or a
  poll has encrypted votes that the ingester did not capture, the run fails and
  alerts the operator. It does not send an empty report.
- A week with a weekly post but genuinely no votes or reactions still renders
  the daily headings; a week with no weekly post renders the empty-week notice.
- The report is sent to the configured recipient and, for an empty week, also to
  the linked account so the operator sees it.

## Deployment

```sh
mkdir -p data
cp .env.example .env   # set WAHA_API_KEY
./deploy/install.sh    # installs the stack and report timers
```

See [docs/deployment.md](docs/deployment.md) and [docs/usage.md](docs/usage.md).

## Data

- `data/config.json` — selected group, ignored phone numbers, weekly recipient.
- `data/weekly-state.json` — last sent windows and last failure alert.
- `data/waha-events.sqlite3` — captured poll votes and reactions.
- `data/logs/imsc-YYYY-MM-DD.log` — daily logs, 30 retained.
- `data/waha/` — WAHA session/auth store.

`data/` is intentionally untracked.
