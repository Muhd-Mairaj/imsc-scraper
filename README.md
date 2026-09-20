# IMSC Scraper

A small TypeScript CLI that creates a read-only monthly WhatsApp activity summary for a Community announcements group through [whatsapp-web.js](https://wwebjs.dev/).

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

Configure the announcements group and ignored admin phones:

```sh
bun run dev setup
```

On the first run, open **WhatsApp > Linked devices > Link a device** on your phone and scan the QR code shown in the terminal. Select the Community announcements group, then enter ignored admin phone numbers in international format, one number per line. Submit a blank line when finished.

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
  "ignoredPhoneNumbers": ["60123456789", "60129876543"]
}
```

Phone values are normalized to digits before saving. Running setup again lets you replace both the selected group and the ignored admin list.

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
