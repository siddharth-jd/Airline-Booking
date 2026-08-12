#!/usr/bin/env bash
# Start / stop / restart the local processes for development.
#
# Processes are identified by BOTH working directory and script path, because
# neither alone is unique: all three HTTP services run `node src/index.js`
# (same command, different directory), and the relay shares its directory with
# the bookings service (same directory, different script). `pkill -f` on either
# one alone kills the wrong things.
#
#   ./scripts/services.sh start [name...]
#   ./scripts/services.sh stop  [name...]
#   ./scripts/services.sh restart [name...]
#   ./scripts/services.sh status
#   ./scripts/services.sh logs <name>
#
# Names: auth flights bookings relay consumer notifier
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${ROOT}/.logs"
ALL=(auth flights bookings relay consumer notifier)

# name -> service directory : script : port ("-" when the process serves no HTTP)
declare -A SPEC=(
  [auth]="auth:src/index.js:4001"
  [flights]="flights:src/index.js:4002"
  [bookings]="bookings:src/index.js:4003"
  [relay]="bookings:src/relay.js:-"
  [consumer]="flights:src/consumer.js:-"
  [notifier]="notifications:src/consumer.js:-"
)

mkdir -p "$LOG_DIR"

spec_field() { echo "${SPEC[$1]}" | cut -d: -f"$2"; }

pids_for() {
  local dir script svc_dir
  dir="$(spec_field "$1" 1)"; script="$(spec_field "$1" 2)"
  svc_dir="${ROOT}/services/${dir}"
  for pid in $(pgrep -f "node ${script}" 2>/dev/null); do
    [[ "$(readlink -f "/proc/$pid/cwd" 2>/dev/null)" == "$svc_dir" ]] && echo "$pid"
  done
}

healthy() {
  local port; port="$(spec_field "$1" 3)"
  [[ "$port" == "-" ]] && return 1
  curl -sf --max-time 1 "http://localhost:${port}/health" >/dev/null 2>&1
}

stop_one() {
  local name="$1" pids
  pids="$(pids_for "$name")"
  if [[ -z "$pids" ]]; then echo "  $name: not running"; return; fi
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null
  for _ in $(seq 20); do [[ -z "$(pids_for "$name")" ]] && break; sleep 0.1; done
  # shellcheck disable=SC2086
  [[ -n "$(pids_for "$name")" ]] && kill -9 $(pids_for "$name") 2>/dev/null
  echo "  $name: stopped"
}

start_one() {
  local name="$1" dir script port
  dir="$(spec_field "$name" 1)"; script="$(spec_field "$name" 2)"; port="$(spec_field "$name" 3)"

  if [[ -n "$(pids_for "$name")" ]]; then echo "  $name: already running (use restart)"; return; fi

  # setsid puts the process in its OWN session and process group, and stdin is
  # closed. Without this the child stays in the caller's process group, which
  # causes two real problems: piping this script's output (`... | tail`) hangs
  # forever because the child inherits the pipe and never closes it, and a
  # `timeout` around the script kills the service it just started.
  ( cd "${ROOT}/services/${dir}" \
      && setsid nohup node "$script" < /dev/null > "${LOG_DIR}/${name}.log" 2>&1 & )

  if [[ "$port" == "-" ]]; then
    # No HTTP endpoint to poll — confirm the process is alive and did not
    # immediately exit on a startup error.
    sleep 2
    if [[ -n "$(pids_for "$name")" ]]; then
      echo "  $name: running"
    else
      echo "  $name: FAILED to start — see ${LOG_DIR}/${name}.log"
      tail -5 "${LOG_DIR}/${name}.log"
      return 1
    fi
    return
  fi

  for _ in $(seq 40); do
    sleep 0.25
    if healthy "$name"; then echo "  $name: up on :${port}"; return; fi
  done
  echo "  $name: FAILED to become healthy — see ${LOG_DIR}/${name}.log"
  tail -5 "${LOG_DIR}/${name}.log"
  return 1
}

status_one() {
  local name="$1" port pids state
  port="$(spec_field "$name" 3)"
  pids="$(pids_for "$name" | tr '\n' ' ')"
  if [[ -z "$pids" ]]; then
    state="down"
  elif [[ "$port" == "-" ]]; then
    state="running"
  else
    healthy "$name" && state="healthy" || state="starting"
  fi
  printf "  %-9s %-6s %-9s pids: %s\n" "$name" "${port/-/ }" "$state" "${pids:-none}"
}

cmd="${1:-status}"; shift || true
targets=("$@"); [[ ${#targets[@]} -eq 0 ]] && targets=("${ALL[@]}")

case "$cmd" in
  start)   echo "starting:";   for s in "${targets[@]}"; do start_one "$s"; done ;;
  stop)    echo "stopping:";   for s in "${targets[@]}"; do stop_one  "$s"; done ;;
  restart) echo "restarting:"
           for s in "${targets[@]}"; do stop_one  "$s"; done
           for s in "${targets[@]}"; do start_one "$s"; done ;;
  status)  echo "status:";     for s in "${targets[@]}"; do status_one "$s"; done ;;
  logs)    tail -f "${LOG_DIR}/${targets[0]}.log" ;;
  *) echo "usage: $0 {start|stop|restart|status|logs} [${ALL[*]}]"; exit 1 ;;
esac
