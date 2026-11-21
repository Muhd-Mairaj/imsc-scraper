# Deployment

The stack replaces the Bun/Chromium scraper with two containers:

- `waha` — WAHA with the **GOWS** engine (whatsmeow in Go). No browser.
- `imsc-ingest` — the webhook receiver that stores poll votes and reactions.

The report itself runs as a one-off container (`imsc-report`) from systemd
timers.

## Requirements

- Docker with Compose v2.
- About 250 MB of RAM for WAHA plus 100 MB for the ingester.
- A one-time WhatsApp re-link (QR or pairing code). The old whatsapp-web.js
  session cannot be reused.

## First install

```sh
git clone <this repo>
cd imsc-scraper
cp .env.example .env
# Set WAHA_API_KEY and the dashboard/Swagger passwords to long random strings.
# Optionally set IMSC_UID/IMSC_GID to the owner of ./data.
mkdir -p data
docker compose up -d waha imsc-ingest
```

Check the stack:

```sh
docker compose ps
docker compose logs -f waha
```

### Pair the device

The WAHA API is bound to `127.0.0.1:3100`. From your machine:

```sh
ssh -L 3100:localhost:3100 <user>@<server>
```

Open <http://localhost:3100>, create/start the `default` session, and scan the
QR from WhatsApp → Linked devices. The QR is also printed in
`docker compose logs waha` because `WAHA_PRINT_QR=True`.

If the session shows `FAILED`, log out and start it again; a session that was
unlinked on the phone must be re-paired.

### Choose the group

```sh
docker compose --profile tools run --rm imsc-report setup
```

This reuses `data/config.json` if it exists, or writes a new one. The existing
`selectedChat.id` is a `...@g.us` group id and remains valid.

### First run

```sh
docker compose --profile tools run --rm imsc-report status
docker compose --profile tools run --rm imsc-report weekly --dry-run
docker compose --profile tools run --rm imsc-report weekly
```

`weekly --dry-run` fails if WAHA's stored history does not reach the start of
the week; let the initial sync finish and retry.

## Systemd

```sh
./deploy/install.sh
```

It installs and enables:

- `imsc-stack.service` — `docker compose up -d --wait waha imsc-ingest`, so the
  session and ingester return after a reboot.
- `imsc-weekly.timer` — Saturdays at 06:00 `Asia/Kuala_Lumpur`.
- `imsc-month-end.timer` — the 1st at 06:00 `Asia/Kuala_Lumpur`.

The timers call:

```sh
docker compose --profile tools run --rm --name imsc-weekly imsc-report weekly
docker compose --profile tools run --rm --name imsc-month-end imsc-report month-end
```

`./deploy/install.sh --print` renders the units without installing them.

## Migrating from the old Chromium scraper

The old Bun/whatsapp-web.js service and the WAHA stack can run side by side for
a short verification window, but only one should send the scheduled report.

1. Stop the old timers so the old service cannot send a duplicate:
   ```sh
   sudo systemctl stop imsc-weekly.timer imsc-month-end.timer
   ```
2. Start WAHA and the ingester, then pair the device as above.
3. Confirm the report:
   ```sh
   docker compose --profile tools run --rm imsc-report status
   docker compose --profile tools run --rm imsc-report weekly --dry-run
   ```
4. Replace the units and timers:
   ```sh
   ./deploy/install.sh
   ```
5. After the first successful WAHA report, remove the old pieces:
   ```sh
   docker rm -f imsc 2>/dev/null || true
   rm -rf data/auth .wwebjs_cache
   ```
   Keep `data/config.json`, `data/weekly-state.json`, and `data/logs/`.

The old `data/config.json` group id and recipient are reused unchanged. The
old `data/weekly-state.json` prevents the first WAHA run from resending a week
that was already recorded.

## Data layout

| Path | Purpose |
|---|---|
| `data/config.json` | Selected group, ignored numbers, weekly recipient. |
| `data/weekly-state.json` | Last sent weekly/month-end windows and last alert. |
| `data/waha-events.sqlite3` | Captured poll votes and reactions. |
| `data/logs/` | Daily logs, 30 retained. |
| `data/waha/` | WAHA session/auth store. Back this up if you want to avoid re-pairing. |

`data/` is untracked by git.

## Upgrades

Pin the WAHA image tag in `compose.yaml` for production. After changing the
image:

```sh
docker compose pull waha
docker compose up -d waha imsc-ingest
```

Keep `data/waha/` across upgrades. A WAHA major update may require a re-pair;
the session is the only unrecoverable piece.

## Troubleshooting

### `WAHA session is ... SCAN_QR_CODE`

Open the dashboard/QR URL and scan. The QR expires quickly; refresh it if the
session status changes.

### `WAHA reports the WhatsApp session as FAILED`

The device was unlinked, the account was restricted, or the session store is
invalid. Log out in the dashboard, delete the session, start it again, and scan
a new QR. Do not delete `data/waha/` unless you are prepared to re-pair.

### `WhatsApp's stored history ... does not reach the report start`

WAHA has not finished its initial sync, or GOWS storage was disabled. Check:

```sh
docker compose --profile tools run --rm imsc-report status
curl -H "X-Api-Key: $WAHA_API_KEY" \
  "http://localhost:3100/api/default/chats/<chatId>/messages?limit=1&sortOrder=asc"
```

Wait for the sync, then retry. The GOWS storage defaults are on; keep
`messageSecrets` enabled so poll votes can be decrypted.

### `the poll has ... encrypted vote ... but the event ingester has none`

`imsc-ingest` was down when the vote arrived. Check
`docker compose logs imsc-ingest` and `docker compose ps`. For the current week,
the poll cannot be reconstructed from the encrypted store; wait for the next
week or re-run after the ingester has been up for a full window.

### `WahaError: ... 401`

`WAHA_API_KEY` in `.env` does not match the key WAHA was started with. Restart
the stack after fixing `.env`.

### Report sends but the ack stays pending

Check `docker compose logs waha` for a send/connection error. The report exits
non-zero and systemd retries; the state is not advanced until the send succeeds.
