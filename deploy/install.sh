#!/usr/bin/env sh
# Install the weekly-report systemd units for this checkout.
#
# The service unit needs two machine-specific values: the checkout location and
# the docker binary. Rather than relying on whoever installs the units to edit
# them by hand, this rewrites both from what is actually on this host, so the
# installed copy cannot point at somebody else's working directory.
#
#   ./deploy/install.sh          install and enable (asks for sudo)
#   ./deploy/install.sh --print  print the rendered service unit and exit
#
# Re-run it after moving the checkout or installing docker somewhere new.
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
repo_dir=$(CDPATH= cd -- "$script_dir/.." && pwd -P)
service_src="$script_dir/imsc-weekly.service"
timer_src="$script_dir/imsc-weekly.timer"

for unit in "$service_src" "$timer_src"; do
  if [ ! -f "$unit" ]; then
    echo "install.sh: missing $unit" >&2
    exit 1
  fi
done

docker_bin=$(command -v docker || true)
if [ -z "$docker_bin" ]; then
  echo "install.sh: docker was not found on PATH" >&2
  if [ "${1:-}" != "--print" ]; then
    exit 1
  fi
  docker_bin=/usr/bin/docker
fi

rendered=$(mktemp)
trap 'rm -f "$rendered"' EXIT
sed \
  -e "s|^WorkingDirectory=.*|WorkingDirectory=$repo_dir|" \
  -e "s|^ExecStart=.*|ExecStart=$docker_bin compose run --rm imsc weekly|" \
  "$service_src" >"$rendered"

if [ "${1:-}" = "--print" ]; then
  cat "$rendered"
  exit 0
fi

if [ "$(id -u)" -ne 0 ]; then
  exec sudo -- "$0" "$@"
fi

install -m 0644 -o root -g root "$rendered" /etc/systemd/system/imsc-weekly.service
install -m 0644 -o root -g root "$timer_src" /etc/systemd/system/imsc-weekly.timer
systemctl daemon-reload
systemctl enable --now imsc-weekly.timer
systemctl reset-failed imsc-weekly.service 2>/dev/null || true

echo "Installed imsc-weekly.service and imsc-weekly.timer"
echo "  WorkingDirectory=$repo_dir"
echo "  ExecStart=$docker_bin compose run --rm imsc weekly"
systemctl list-timers imsc-weekly.timer --no-pager || true
