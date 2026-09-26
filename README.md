# IMSC Scraper

A small TypeScript CLI that creates a read-only monthly WhatsApp activity summary for a Community announcements group through [whatsapp-web.js](https://wwebjs.dev/).

## Commands

```sh
bun run dev --help
```

- `verify` (default) — write the current month's engagement summary.
- `setup` — link WhatsApp, choose the group, and set the weekly recipient.
- `weekly` — send the weekly engagement report (`--force`, `--dry-run`).

`--help` (or `-h`) prints this list without starting WhatsApp. In Docker: `docker compose run --rm imsc --help`.

## Prerequisites

- [Bun](https://bun.com/) 1.3 or newer
- A WhatsApp account with access to the target Community announcements group
- `uv` for running the pre-commit tool without managing a Python environment directly

## Setup

Install the pinned dependencies:

```sh
bun install
```

Optionally install the repository's Git hook:

```sh
uvx pre-commit install
```

Configure the announcements group, ignored admin phones, and the weekly report recipient:

```sh
bun run dev setup
```

On the first run, open **WhatsApp > Linked devices > Link a device** on your phone and scan the QR code shown in the terminal. Select the Community announcements group, then enter ignored admin phone numbers in international format, one number per line. Submit a blank line when finished. Finally, enter the phone number that should receive the weekly report, or leave it blank to skip weekly reports.

```text
+60 12-345 6789
60129876543

```

The private configuration is stored at `data/config.json`:

```json
{
  "selectedChat": {
    "id": "1234567890@g.us",
    "name": "Community Announcements"
  },
  "ignoredPhoneNumbers": ["60123456789", "60129876543"],
  "weeklyReportRecipient": "60123456789"
}
```

Phone values are normalized to digits before saving. Running setup again lets you replace the selected group, the ignored admin list, and the weekly report recipient.

## Create the monthly summary

```sh
bun run dev
```

The command reads the configured group, prints the current-month activity summary, and writes the identical summary to the private local file:

```text
data/monthly-YYYY-MM.txt
```

Poll participation is displayed with activity value `2`; reaction participation is displayed with activity value `1`. Ignored admin phones are excluded. A valid activity item with no eligible participants keeps its date heading. If history, engagement, or identity data is unavailable, the summary prints an explicit warning rather than treating it as zero activity.

The linked-device session, configuration, and monthly output all remain under the ignored `data/` directory and should stay private.

## Weekly engagement report

```sh
bun run dev weekly
```

Sends the configured `weeklyReportRecipient` a WhatsApp message covering the seven complete local days ending at the most recent Saturday 00:00 `Asia/Kuala_Lumpur`. Every script-sent message starts with `[AUTO MESSAGE]` and ends with the bot signature so it is distinguishable from messages you type yourself.

- An empty week sends a notice to the recipient and to your own number.
- A failure sends a best-effort alert to your own number, then exits non-zero so the scheduler records the failure.
- Sends are idempotent per window; the last successfully sent window is recorded in `data/weekly-state.json`.
- `--force` skips the idempotency check and re-sends the report (and the failure alert) for the current window:

  ```sh
  bun run dev weekly --force
  ```

- `--dry-run` collects and prints the exact message that would be sent, without sending it or updating the state file. It also bypasses the idempotency check, so it is a safe way to inspect a report:

  ```sh
  bun run dev weekly --dry-run
  ```

The failure alert is best-effort: it cannot be delivered if WhatsApp itself is unreachable.

## Logs

Every run appends timestamped, levelled lines to a daily file under `data/logs/` (`imsc-YYYY-MM-DD.log`, UTC). Each line records the command and runtime, the WhatsApp lifecycle (initialising, ready, authenticated, QR), collection counts and warnings, send/acknowledgement outcomes, and the full stack trace of any failure. The same lines are mirrored to the terminal.

The logger keeps the newest 30 daily files, so a timer-driven server does not fill the disk. Logs live with the rest of the private state under `data/` and are excluded from Git.

```text
2026-09-20T10:04:31.882Z INFO [weekly] Weekly run starting: recipient=60123456789@c.us, self=60199999999@c.us, force=false, dryRun=false.
2026-09-20T10:04:31.884Z INFO [weekly] Weekly window: 12/09/2026 – 18/09/2026 (Asia/Kuala_Lumpur), ending 1789747200000.
2026-09-20T10:04:33.117Z INFO [weekly] Collected 4 activity item(s); the week is not empty.
2026-09-20T10:04:33.640Z INFO [weekly] WhatsApp accepted message true_60123456789@c.us_3A... for 60123456789@c.us (ack=1: sent to WhatsApp).
2026-09-20T10:04:35.201Z INFO [weekly] Message true_60123456789@c.us_3A... settled at ack=2 (delivered).
2026-09-20T10:04:35.205Z INFO [weekly] Sent the weekly report for the window ending 1789747200000.
```

## Headless Docker deployment

For a home server, Docker runs Chromium headlessly while keeping WhatsApp session data, configuration, and summaries in the local `data/` directory.

Build the image after cloning:

```sh
docker compose build
```

Create the host `data/` directory before the first run, otherwise Docker creates it as root and the non-root container cannot write the session or config:

```sh
mkdir -p data
```

Run setup interactively over SSH. The QR code is printed in the terminal; scan it from **WhatsApp > Linked devices > Link a device**:

```sh
docker compose run --rm imsc setup
```

Create or refresh the monthly summary:

```sh
docker compose run --rm imsc
```

Keep the host `data/` directory private and backed up. It is mounted into the container at `/app/data` and is intentionally excluded from the Docker image and Git.

The container runs as uid/gid `1000`, matching the image's `bun` user and the owner of `./data`, so session and summary files stay owned by you on the host instead of coming back root-owned. If your host user has a different id, pass it through:

```sh
IMSC_UID="$(id -u)" IMSC_GID="$(id -g)" docker compose run --rm imsc setup
```

Chromium runs with `--no-sandbox` because the container has no usable sandbox and unprivileged user namespaces are unavailable; this is set by `WHATSAPP_DOCKER=true` and is required, not optional.

### Weekly report on a timer

The weekly report runs from a systemd timer at 06:00 every Saturday `Asia/Kuala_Lumpur`. Install the units with the helper, which points the service at this checkout and the `docker` binary on the host:

```sh
./deploy/install.sh
```

It rewrites `WorkingDirectory` and `ExecStart`, installs both units under `/etc/systemd/system`, then reloads and enables the timer. Run it again after moving the checkout. To install by hand instead, edit `deploy/imsc-weekly.service` first, then:

```sh
sudo cp deploy/imsc-weekly.service deploy/imsc-weekly.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now imsc-weekly.timer
```

The unit runs compose as `${IMSC_UID:-1000}:${IMSC_GID:-1000}`. If the owner of `./data` is not uid 1000, put `IMSC_UID` and `IMSC_GID` in `/etc/imsc-weekly.env` (the unit reads it if present). Otherwise the container cannot write `data/weekly-state.json`, and because the report is sent before the state is saved, every retry re-sends it.

Inspect runs and verify the schedule:

```sh
journalctl -u imsc-weekly.service
systemctl list-timers imsc-weekly.timer
```

`Persistent=true` makes systemd run a missed report on the next boot. The window is anchored to the Saturday 00:00 boundary, so a late catch-up run still reports the correct week rather than a shifted one. `Restart=on-failure` retries are bounded to avoid spinning on a persistent fault.

Run one report by hand with:

```sh
docker compose run --rm imsc weekly
```

Re-send the current window even if it was already recorded:

```sh
docker compose run --rm imsc weekly --force
```

Preview the exact message without sending it or updating the state file:

```sh
docker compose run --rm imsc weekly --dry-run
```

Failure alerts are best-effort and go to your own number. Both the recipient and your own number are resolved to their current WhatsApp id before sending.

### Troubleshooting a stuck run

If a run logs `WhatsApp authenticated` but never reaches `WhatsApp Web is ready`, the cached WhatsApp Web build or a stale Chromium profile lock is the usual cause. Clear them and retry:

```sh
rm -rf data/.wwebjs_cache data/auth/session-imsc-scraper/Singleton*
```

Sends are resolved to the recipient's current WhatsApp id (LID) first. If a run reports a number as not registered on WhatsApp, that number has no WhatsApp account.


## Quality commands

```sh
bun test
bun run format
bun run lint
bun run check
bun run typecheck
bun run build
uvx pre-commit run --all-files
```

The pre-commit configuration fixes trailing whitespace and final newlines, then runs Biome formatting and linting on supported files.

## Important

`whatsapp-web.js` is unofficial and depends on WhatsApp Web behavior that can change. Use this project only with accounts and groups you are authorized to access, and avoid bulk or abusive automation.
