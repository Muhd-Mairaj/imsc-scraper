# Deployment

## Docker

```sh
mkdir -p data
docker compose build
docker compose run --rm imsc setup        # link WhatsApp
docker compose run --rm imsc              # monthly summary
docker compose run --rm imsc weekly       # weekly report
```

- Create `data/` before the first run, and keep it private and backed up. It is mounted at `/app/data`; without it Docker creates the directory as root and the non-root container cannot write the session.
- The container runs as uid/gid `1000`, so files stay owned by you on the host. If your user differs, pass it through:

  ```sh
  IMSC_UID="$(id -u)" IMSC_GID="$(id -g)" docker compose run --rm imsc setup
  ```

- Chromium runs with `--no-sandbox` (`WHATSAPP_DOCKER=true`) because the container has no usable sandbox and unprivileged user namespaces are unavailable. This is required, not optional.

## Weekly timer

`./deploy/install.sh` installs both systemd units, points the service at this checkout and the `docker` binary on the host, then reloads and enables the timer (every Saturday at 06:00 `Asia/Kuala_Lumpur`). Re-run it after moving the checkout.

If `./data` is not owned by uid 1000, set `IMSC_UID` and `IMSC_GID` in `/etc/imsc-weekly.env`. Otherwise the container cannot write `data/weekly-state.json`, and because the report is sent before the state is saved, a retry re-sends it.

Inspect runs and verify the schedule:

```sh
systemctl list-timers imsc-weekly.timer
journalctl -u imsc-weekly.service
```

`Persistent=true` runs a missed report on the next boot. `Restart=on-failure` retries are bounded so a persistent fault cannot spin.

## Troubleshooting

- Stuck after `WhatsApp authenticated` (never reaches `WhatsApp Web is ready`): the cached WhatsApp Web build or a stale Chromium profile lock is the usual cause. Clear them and retry:

  ```sh
  rm -rf data/.wwebjs_cache data/auth/session-imsc-scraper/Singleton*
  ```

- A run reports a number as "not registered on WhatsApp": that number has no WhatsApp account.
