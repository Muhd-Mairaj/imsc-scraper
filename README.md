# IMSC Scraper

A read-only monthly and weekly WhatsApp activity summary for a Community announcements group, via [whatsapp-web.js](https://wwebjs.dev/).

## Requirements

- [Bun](https://bun.com/) 1.3 or newer
- A WhatsApp account with access to the target group

## Commands

- `verify` (default) — write the current month's engagement summary.
- `setup` — link WhatsApp, choose the group, set the weekly recipient.
- `weekly` — send the weekly engagement report (`--force`, `--dry-run`).
- `help` — print usage without starting WhatsApp (`--help` or `-h`).

```sh
bun run dev --help
```

## Getting started

```sh
bun install
bun run dev setup        # scan the QR code, choose the group and recipient
bun run dev              # monthly summary
bun run dev weekly       # weekly report
```

Configuration, summary semantics, report behaviour, and logs are covered in [docs/usage.md](docs/usage.md).

## Docker

```sh
mkdir -p data
docker compose build
docker compose run --rm imsc setup
```

Docker and systemd timer details, uid/gid, and troubleshooting are in [docs/deployment.md](docs/deployment.md).

## Development

```sh
bun test
bun run check            # format + lint
bun run typecheck
bun run build
uvx pre-commit install   # optional Git hook (requires uv)
```

## Important

`whatsapp-web.js` is unofficial and depends on WhatsApp Web behavior that can change. Use this project only with accounts and groups you are authorized to access, and avoid bulk or abusive automation.
