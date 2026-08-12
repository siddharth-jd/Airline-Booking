#!/usr/bin/env bash
# Runs the k6 load tests against the containerised stack.
#
# k6 runs as a container joined to the project's Docker network, so it addresses
# nginx by name (http://nginx) exactly as a real client inside the network would.
# Nothing needs installing on the host, and the traffic goes through the gateway
# rather than around it — measuring the deployment shape that actually ships.
#
#   ./scripts/loadtest.sh search     # read path
#   ./scripts/loadtest.sh booking    # contended write path
#   ./scripts/loadtest.sh all
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NETWORK="${NETWORK:-airline-booking_airline}"
K6_IMAGE="${K6_IMAGE:-grafana/k6:0.54.0}"
RESULTS="${ROOT}/.logs/loadtest"

mkdir -p "$RESULTS"

run_one() {
  local name="$1" script="$2"
  echo
  echo "═══════════════════════════════════════════════════════════"
  echo "  k6: $name"
  echo "═══════════════════════════════════════════════════════════"

  docker run --rm -i \
    --network "$NETWORK" \
    -v "${ROOT}/k6:/scripts:ro" \
    -v "${RESULTS}:/results" \
    "$K6_IMAGE" run \
      --summary-export "/results/${name}.json" \
      "/scripts/${script}"
}

case "${1:-all}" in
  search)  run_one search  search-load.js ;;
  booking)
    "${ROOT}/scripts/loadtest-seed.sh"
    run_one booking booking-load.js
    ;;
  all)
    run_one search search-load.js
    "${ROOT}/scripts/loadtest-seed.sh"
    run_one booking booking-load.js
    ;;
  *) echo "usage: $0 {search|booking|all}"; exit 1 ;;
esac

echo
echo "summaries written to ${RESULTS}/"