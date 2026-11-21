#!/usr/bin/env sh
# Install the IMSC report units for this checkout.
#
#   ./deploy/install.sh          install and enable (asks for sudo)
#   ./deploy/install.sh --print  print the rendered units and exit
#
# Create .env from .env.example before installing: WAHA refuses to start
# without WAHA_API_KEY.
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
if [ ! -f "$script_dir/imsc-stack.service" ]; then
  echo "install.sh: missing $script_dir/imsc-stack.service" >&2
  exit 1
fi

docker_bin=$(command -v docker || true)
if [ -z "$docker_bin" ]; then
  echo "install.sh: docker was not found on PATH" >&2
  if [ "${1:-}" != "--print" ]; then
    exit 1
  fi
  docker_bin=/usr/bin/docker
fi

render_report_service() {
  sed \
    -e "s|^WorkingDirectory=.*|WorkingDirectory=$repo_dir|" \
    -e "s|^ExecStartPre=.*|ExecStartPre=-$docker_bin rm -f imsc-$2|" \
    -e "s|^ExecStart=.*|ExecStart=$docker_bin compose --profile tools run --rm --name imsc-$2 imsc-report $2|" \
    -e "s|^ExecStop=.*|ExecStop=-$docker_bin rm -f imsc-$2|" \
    "$1"
}

render_stack_service() {
  sed \
    -e "s|^WorkingDirectory=.*|WorkingDirectory=$repo_dir|" \
    -e "s|^ExecStart=.*|ExecStart=$docker_bin compose up -d --wait waha imsc-ingest|" \
    -e "s|^ExecStop=.*|ExecStop=$docker_bin compose stop waha imsc-ingest|" \
    "$1"
}

if [ "${1:-}" = "--print" ]; then
  render_stack_service "$script_dir/imsc-stack.service"
  for name in $units; do
    render_report_service "$script_dir/$name.service" "${name#imsc-}"
  done
  exit 0
fi

if [ "$(id -u)" -ne 0 ]; then
  exec sudo -- "$0" "$@"
fi

if [ ! -f "$repo_dir/.env" ]; then
  echo "install.sh: create $repo_dir/.env from .env.example first" >&2
  exit 1
fi

stack_rendered=$(mktemp)
weekly_rendered=$(mktemp)
month_end_rendered=$(mktemp)
trap 'rm -f "$stack_rendered" "$weekly_rendered" "$month_end_rendered"' EXIT

render_stack_service "$script_dir/imsc-stack.service" >"$stack_rendered"
render_report_service "$script_dir/imsc-weekly.service" weekly >"$weekly_rendered"
render_report_service "$script_dir/imsc-month-end.service" month-end >"$month_end_rendered"

install -m 0644 -o root -g root "$stack_rendered" /etc/systemd/system/imsc-stack.service
install -m 0644 -o root -g root "$weekly_rendered" /etc/systemd/system/imsc-weekly.service
install -m 0644 -o root -g root "$script_dir/imsc-weekly.timer" /etc/systemd/system/imsc-weekly.timer
install -m 0644 -o root -g root "$month_end_rendered" /etc/systemd/system/imsc-month-end.service
install -m 0644 -o root -g root "$script_dir/imsc-month-end.timer" /etc/systemd/system/imsc-month-end.timer
systemctl daemon-reload
systemctl enable --now imsc-stack.service imsc-weekly.timer imsc-month-end.timer
systemctl reset-failed imsc-stack.service imsc-weekly.service imsc-month-end.service 2>/dev/null || true

echo "Installed the IMSC WAHA stack and report timers"
echo "  WorkingDirectory=$repo_dir"
echo "  Stack:   $docker_bin compose up -d --wait waha imsc-ingest"
echo "  Weekly:  $docker_bin compose --profile tools run --rm imsc-report weekly"
echo "  Monthly: $docker_bin compose --profile tools run --rm imsc-report month-end"
systemctl list-timers imsc-weekly.timer imsc-month-end.timer --no-pager || true
