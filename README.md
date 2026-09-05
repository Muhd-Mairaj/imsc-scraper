# IMSC Scraper

An incremental TypeScript CLI for working with a WhatsApp Community announcements group through [whatsapp-web.js](https://wwebjs.dev/).

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

## Select the announcements group

Run the CLI from the repository root:

```sh
bun run dev
```

On the first run, open **WhatsApp > Linked devices > Link a device** on your phone and scan the QR code shown in the terminal. After WhatsApp finishes loading, select the Community announcements group from the list.

The result is stored at `data/config.json`:

```json
{
  "selectedChat": {
    "id": "1234567890@g.us",
    "name": "Community Announcements"
  }
}
```

The linked-device session is stored under `data/auth/`. The entire `data/` directory is ignored by Git and should remain private. Running the command again reuses the session and lets you replace the selected group.

## Quality commands

```sh
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
