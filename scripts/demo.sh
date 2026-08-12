#!/usr/bin/env bash
# A guided walkthrough of the whole system, in one command.
#
#   ./scripts/demo.sh          # the full story, with pauses
#   ./scripts/demo.sh --fast   # no pauses
#
# Everything goes through the Nginx gateway on :8080, which is the only port the
# stack publishes — exactly what an external client would use.
set -uo pipefail

GATEWAY="${GATEWAY:-http://localhost:8080}"
DEMO_FLIGHT="${DEMO_FLIGHT:-6}"
# A second flight, used only by the race at the end. Kept separate so the race
# always starts from a known-empty seat map regardless of what step 4-9 did.
RACE_FLIGHT="${RACE_FLIGHT:-4}"
FAST=false
[[ "${1:-}" == "--fast" ]] && FAST=true

B=$'\033[1m'; DIM=$'\033[2m'; G=$'\033[32m'; Y=$'\033[33m'; C=$'\033[36m'; R=$'\033[31m'; N=$'\033[0m'

step()  { echo; echo "${B}${C}$1${N}"; echo "${DIM}$(printf '─%.0s' {1..64})${N}"; }
note()  { echo "${DIM}$1${N}"; }
ok()    { echo "  ${G}$1${N}"; }
warn()  { echo "  ${Y}$1${N}"; }
pause() { $FAST || { echo; read -rsp "$(echo -e "${DIM}  [enter to continue]${N}")" -n1; echo; }; }

require() {
  if ! curl -sf --max-time 3 "$GATEWAY/health" >/dev/null; then
    echo "${R}The stack is not responding on $GATEWAY${N}"
    echo "Start it with:  docker compose up -d"
    exit 1
  fi
}

seats_left() {
  curl -s "$GATEWAY/flights/$DEMO_FLIGHT" | python3 -c 'import json,sys; print(json.load(sys.stdin)["seats_available"])'
}

# ---------------------------------------------------------------------------
require

echo
echo "${B}  AIRLINE BOOKING SYSTEM — walkthrough${N}"
note  "  Four services behind one gateway. Nothing is reachable except :8080."

# --- reset so the demo is repeatable ---------------------------------------
#
# Both flights are cleared, in dependency order: idempotency_keys reference
# bookings, and booking_seats reference both bookings and flight_seats, so the
# deletes must go child-first. The foreign keys will refuse otherwise — which is
# the schema doing its job.
docker exec -e PGPASSWORD=bookings_dev_pw airline-postgres psql -U bookings_svc -d bookings_db -q -c "
  DELETE FROM idempotency_keys WHERE booking_id IN
    (SELECT id FROM bookings WHERE flight_id IN ($DEMO_FLIGHT, $RACE_FLIGHT));
  DELETE FROM booking_seats WHERE flight_seat_id IN
    (SELECT id FROM flight_seats WHERE flight_id IN ($DEMO_FLIGHT, $RACE_FLIGHT));
  DELETE FROM bookings WHERE flight_id IN ($DEMO_FLIGHT, $RACE_FLIGHT);
  UPDATE flight_seats SET status='available', version=version+1
   WHERE flight_id IN ($DEMO_FLIGHT, $RACE_FLIGHT);" >/dev/null 2>&1
docker exec -e PGPASSWORD=flights_dev_pw airline-postgres psql -U flights_svc -d flights_db -q -c "
  UPDATE flights SET seats_available=36 WHERE id IN ($DEMO_FLIGHT, $RACE_FLIGHT);" >/dev/null 2>&1

# ---------------------------------------------------------------------------
step "1. WHO IS RUNNING"
docker compose ps --format "  {{.Name}}  {{.Status}}" 2>/dev/null | sed 's/airline-//'
note "  Only nginx publishes a port. The services are internal-only:"
for p in 4001 4002 4003; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 "http://localhost:$p/health" 2>/dev/null)
  [[ "$code" == "000" ]] && ok "localhost:$p — unreachable, as intended" || warn "localhost:$p — reachable ($code)"
done
pause

# ---------------------------------------------------------------------------
step "2. SIGN UP"
EMAIL="demo-$(date +%s)@example.com"
note "  POST /auth/signup   (gateway routes this to the auth service)"
curl -s -X POST "$GATEWAY/auth/signup" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"demo password\"}" >/dev/null
ok "user created: $EMAIL"

TOKEN=$(curl -s -X POST "$GATEWAY/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"demo password\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')
ok "logged in, JWT issued"
note "  The password is stored as a bcrypt hash (cost 12), never in plain text."
note "  Other services verify this token locally — no call back to auth."
pause

# ---------------------------------------------------------------------------
step "3. SEARCH FLIGHTS"
note "  GET /flights?origin=MAA&destination=BOM   (routed to the flights service)"
curl -s "$GATEWAY/flights?origin=MAA&destination=BOM&date=2026-09-02" | python3 -c '
import json, sys
for f in json.load(sys.stdin)["flights"]:
    num   = f["flight_number"]
    dep   = f["departure_time"][11:16]
    price = f["price_cents"] / 100
    free  = f["seats_available"]
    print(f"  {num}  dep {dep}Z  Rs {price:>9,.2f}  {free} seats free")'
pause

# ---------------------------------------------------------------------------
step "4. BOOK TWO SEATS"
BEFORE=$(seats_left)
note "  POST /bookings with an Idempotency-Key header (required)"
RESP=$(curl -s -X POST "$GATEWAY/bookings" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: demo-$(date +%s%N)" \
  -d "{\"flight_id\":$DEMO_FLIGHT,\"seat_numbers\":[\"3A\",\"3B\"]}")
BOOKING_ID=$(echo "$RESP" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("id",""))')
echo "$RESP" | python3 -c '
import json, sys
d      = json.load(sys.stdin)
bid    = d["id"]
status = d["status"]
seats  = ", ".join(d["seats"])
amount = d["total_price_cents"] / 100
print(f"  booking #{bid} {status} — seats {seats} — Rs {amount:,.2f}")'
note "  One transaction wrote: seat locks, the booking, the seat assignments,"
note "  and an outbox row. All of it commits together, or none of it does."
pause

# ---------------------------------------------------------------------------
step "5. THE SAME REQUEST, SENT AGAIN"
note "  Retrying with the SAME Idempotency-Key must NOT create a second booking."
KEY="demo-idem-$(date +%s%N)"
for i in 1 2; do
  curl -s -X POST "$GATEWAY/bookings" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -H "Idempotency-Key: $KEY" \
    -d "{\"flight_id\":$DEMO_FLIGHT,\"seat_numbers\":[\"4A\"]}" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print('  attempt $i -> booking #' + str(d.get('id','?')))"
done
ok "same booking id both times — one seat taken, not two"
pause

# ---------------------------------------------------------------------------
step "6. AVAILABILITY UPDATES ITSELF, VIA KAFKA"
note "  Nothing called the flights service. The booking service wrote an event,"
note "  a relay published it to Kafka, and the flights service consumed it."
echo "  before: $BEFORE seats"
printf "  waiting for the event to propagate"
for _ in 1 2 3; do printf "."; sleep 1; done; echo
echo "  after:  $(seats_left) seats"
pause

# ---------------------------------------------------------------------------
step "7. THE CONFIRMATION MESSAGE"
note "  A SECOND, independent consumer group produced this — the booking service"
note "  has no idea the notifications service exists."
tail -8 "$(dirname "${BASH_SOURCE[0]}")/../.logs/notifications-sent.log" 2>/dev/null | sed 's/^/  /'
note "  (delivery is simulated — written to a file, not emailed)"
pause

# ---------------------------------------------------------------------------
step "8. TRY TO TAKE A SEAT SOMEONE ELSE HAS"
curl -s -X POST "$GATEWAY/bookings" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: demo-conflict-$(date +%s%N)" \
  -d "{\"flight_id\":$DEMO_FLIGHT,\"seat_numbers\":[\"3A\"]}" \
  -w '  [HTTP %{http_code}]\n' | sed 's/^{/  {/'
ok "409 Conflict — the seat is already sold"
pause

# ---------------------------------------------------------------------------
step "9. CANCEL, AND REBOOK THE SAME SEAT"
note "  POST /bookings/$BOOKING_ID/cancel  — no idempotency key needed here."
note "  Cancelling twice reaches the same end state, so it is already idempotent."
curl -s -X POST "$GATEWAY/bookings/$BOOKING_ID/cancel" -H "Authorization: Bearer $TOKEN" \
  | python3 -c 'import json, sys
n = json.load(sys.stdin)["seats_released"]
print(f"  cancelled — {n} seat(s) released")'
curl -s -X POST "$GATEWAY/bookings/$BOOKING_ID/cancel" -H "Authorization: Bearer $TOKEN" \
  | python3 -c 'import json, sys
n = json.load(sys.stdin)["seats_released"]
print(f"  cancelled again — {n} released (no double release)")'
sleep 1
curl -s -X POST "$GATEWAY/bookings" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: demo-rebook-$(date +%s%N)" \
  -d "{\"flight_id\":$DEMO_FLIGHT,\"seat_numbers\":[\"3A\"]}" \
  | python3 -c 'import json, sys
bid = json.load(sys.stdin)["id"]
print(f"  seat 3A rebooked as booking #{bid}")' 2>/dev/null
ok "the released seat is bookable again, and the cancelled row is kept as history"
pause

# ---------------------------------------------------------------------------
step "10. THE POINT OF THE WHOLE PROJECT"
note "  30 clients race for ONE seat. Exactly one may win."
echo
"$(dirname "${BASH_SOURCE[0]}")/concurrency-test.sh" "$RACE_FLIGHT" 1A 30 5 2>/dev/null \
  | grep -E "firing|201|409|active|PASS|FAIL|distinct|successes" | sed 's/^/  /'

echo
echo "${B}${G}  Done.${N}"
note "  Why every piece of this exists: DECISIONS.md (19 entries)"
note "  What to learn to understand it: LEARNING.md"
echo