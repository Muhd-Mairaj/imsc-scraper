#!/usr/bin/env sh
# Install the report systemd units for this checkout.
#
# Each service unit needs two machine-specific values: the checkout location and
# the docker binary. Rather than relying on whoever installs the units to edit
# them by hand, this rewrites both from what is actually on this host, so the
# installed copy cannot point at somebody else's working directory.
#
#   ./deploy/install.sh          install and enable (asks for sudo)
#   ./deploy/install.sh --print  print the rendered service units and exit
#
# Re-run it after moving the checkout or installing docker somewhere new.
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
repo_dir=$(CDPATH= cd -- "$script_dir/.." && pwd -P)

units="imsc-weekly imsc-month-end"
for name in $units; do
  for suffix in service timer; do
    if [ ! -f "$script_dir/$name.$suffix" ]; then
      echo "install.sh: missing $script_dir/$name.$suffix" >&2
      exit 1
    fi
  done
done

docker_bin=$(command -v docker || true)
if [ -z "$docker_bin" ]; then
  echo "install.sh: docker was not found on PATH" >&2
  if [ "${1:-}" != "--print" ]; then
    exit 1
  fi
  docker_bin=/usr/bin/docker
fi

render_service() {
  sed \
    -e "s|^WorkingDirectory=.*|WorkingDirectory=$repo_dir|" \
    -e "s|^ExecStart=.*|ExecStart=$docker_bin compose run --rm imsc $2|" \
    "$1"
}

if [ "${1:-}" = "--print" ]; then
  for name in $units; do
    render_service "$script_dir/$name.service" "${name#imsc-}"
  done
  exit 0
fi

if [ "$(id -u)" -ne 0 ]; then
  exec sudo -- "$0" "$@"
fi

weekly_rendered=$(mktemp)
month_end_rendered=$(mktemp)
trap 'rm -f "$weekly_rendered" "$month_end_rendered"' EXIT

render_service "$script_dir/imsc-weekly.service" weekly >"$weekly_rendered"
render_service "$script_dir/imsc-month-end.service" month-end >"$month_end_rendered"

install -m 0644 -o root -g root "$weekly_rendered" /etc/systemd/system/imsc-weekly.service
install -m 0644 -o root -g root "$script_dir/imsc-weekly.timer" /etc/systemd/system/imsc-weekly.timer
install -m 0644 -o root -g root "$month_end_rendered" /etc/systemd/system/imsc-month-end.service
install -m 0644 -o root -g root "$script_dir/imsc-month-end.timer" /etc/systemd/system/imsc-month-end.timer
systemctl daemon-reload
systemctl enable --now imsc-weekly.timer imsc-month-end.timer
systemctl reset-failed imsc-weekly.service imsc-month-end.service 2>/dev/null || true

echo "Installed the weekly and month-end report timers"
echo "  WorkingDirectory=$repo_dir"
echo "  ExecStart=$docker_bin compose run --rm imsc weekly"
echo "  ExecStart=$docker_bin compose run --rm imsc month-end"
systemctl list-timers imsc-weekly.timer imsc-month-end.timer --no-pager || true
