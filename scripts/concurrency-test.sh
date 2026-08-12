#!/usr/bin/env bash
# Concurrency proof: fire N simultaneous requests for the SAME seat and assert
# that exactly one succeeds.
#
# This is the test that substantiates "prevented double booking". Without the
# row locking in bookingService.js, several of these would return 201 and the
# seat would be sold twice.
#
#   ./scripts/concurrency-test.sh [flight_id] [seat_number] [concurrency]
set -uo pipefail

FLIGHT_ID="${1:-2}"
SEAT="${2:-1A}"
N="${3:-20}"

# Defaults to the Nginx gateway, which is the only entry point in the
# containerised stack. Override for the host-mode workflow, where each service
# publishes its own port:
#
#   AUTH_URL=http://localhost:4001 BOOKINGS_URL=http://localhost:4003 ./scripts/concurrency-test.sh
#
# Running the proof through the proxy rather than around it matters: it shows
# the invariant holds in the deployment shape that actually ships, including
# whatever connection pooling and keep-alive the proxy introduces.
GATEWAY_URL="${GATEWAY_URL:-http://localhost:8080}"
BOOKINGS_URL="${BOOKINGS_URL:-$GATEWAY_URL}"
AUTH_URL="${AUTH_URL:-$GATEWAY_URL}"
EMAIL="racer@example.com"
PASSWORD="race condition test"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Sign up (ignore 409 if the user already exists), then log in.
curl -s -o /dev/null -X POST "$AUTH_URL/auth/signup" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"

TOKEN="$(curl -s -X POST "$AUTH_URL/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')"

if [[ -z "$TOKEN" ]]; then
  echo "could not obtain a token — is the auth service running?" >&2
  exit 1
fi

echo "firing $N concurrent requests for flight $FLIGHT_ID seat $SEAT"
echo

# Each request carries a DIFFERENT idempotency key. That is the point: these
# are not retries of one request, they are N genuinely competing clients. If
# they shared a key, idempotency alone would collapse them and the seat locking
# would never be exercised.
for i in $(seq 1 "$N"); do
  curl -s -o "$TMP/body.$i" -w '%{http_code}\n' \
    -X POST "$BOOKINGS_URL/bookings" \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -H "Idempotency-Key: race-$(date +%s%N)-$i" \
    -d "{\"flight_id\":$FLIGHT_ID,\"seat_numbers\":[\"$SEAT\"]}" \
    > "$TMP/code.$i" &
done
wait

echo "HTTP status distribution:"
cat "$TMP"/code.* | sort | uniq -c | sort -rn | sed 's/^/  /'
echo

SUCCESSES=$(grep -l '^201$' "$TMP"/code.* 2>/dev/null | wc -l)
echo "201 Created responses: $SUCCESSES"

echo
echo "database truth — active assignments for this seat:"
docker exec -e PGPASSWORD=bookings_dev_pw airline-postgres \
  psql -U bookings_svc -d bookings_db -t -c \
  "SELECT count(*)
     FROM booking_seats bs
     JOIN flight_seats fs ON fs.id = bs.flight_seat_id
    WHERE fs.flight_id = $FLIGHT_ID
      AND trim(fs.seat_number) = '$SEAT'
      AND bs.cancelled_at IS NULL;" | tr -d ' '

echo
if [[ "$SUCCESSES" -eq 1 ]]; then
  echo "PASS — exactly one booking won the race."
else
  echo "FAIL — expected exactly 1 success, got $SUCCESSES."
  exit 1
fi

# ---------------------------------------------------------------------------
# Scenario 2: exhaust a flight through the SKIP LOCKED path.
#
# Every client asks for ANY seat rather than a specific one, so the seats are
# not contended — SKIP LOCKED lets each transaction step over rows the others
# hold and take a different one. The correct outcome is: successes == capacity,
# and every success gets a DISTINCT seat.
# ---------------------------------------------------------------------------
EXHAUST_FLIGHT="${4:-3}"

CAPACITY="$(docker exec -e PGPASSWORD=bookings_dev_pw airline-postgres \
  psql -U bookings_svc -d bookings_db -t -c \
  "SELECT count(*) FROM flight_seats WHERE flight_id = $EXHAUST_FLIGHT AND status = 'available';" | tr -d ' ')"

if [[ "${CAPACITY:-0}" -eq 0 ]]; then
  echo
  echo "skipping scenario 2: flight $EXHAUST_FLIGHT has no free seats left"
  echo "(re-seed with: cd services/bookings && npx sequelize-cli db:seed:undo:all && npm run seed)"
  exit 0
fi

OVERSUBSCRIBE=$(( CAPACITY + 4 ))
echo
echo "─────────────────────────────────────────────────────────"
echo "firing $OVERSUBSCRIBE concurrent 'any seat' requests at flight $EXHAUST_FLIGHT ($CAPACITY free)"
echo

set +m  # silence bash job-control "Done" chatter
for i in $(seq 1 "$OVERSUBSCRIBE"); do
  curl -s -o /dev/null -w '%{http_code}\n' \
    -X POST "$BOOKINGS_URL/bookings" \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -H "Idempotency-Key: exhaust-$(date +%s%N)-$i" \
    -d "{\"flight_id\":$EXHAUST_FLIGHT,\"seat_count\":1}" \
    > "$TMP/ex.$i" 2>/dev/null &
done
wait 2>/dev/null

echo "HTTP status distribution:"
cat "$TMP"/ex.* | sort | uniq -c | sort -rn | sed 's/^/  /'
echo

EX_OK=$(grep -c '^201$' "$TMP"/ex.* 2>/dev/null | awk -F: '{s+=$2} END {print s+0}')

read -r ASSIGNMENTS DISTINCT <<<"$(docker exec -e PGPASSWORD=bookings_dev_pw airline-postgres \
  psql -U bookings_svc -d bookings_db -t -A -F' ' -c \
  "SELECT count(*), count(DISTINCT bs.flight_seat_id)
     FROM booking_seats bs
     JOIN flight_seats fs ON fs.id = bs.flight_seat_id
    WHERE fs.flight_id = $EXHAUST_FLIGHT AND bs.cancelled_at IS NULL;")"

echo "successes: $EX_OK (capacity was $CAPACITY)"
echo "active assignments: $ASSIGNMENTS, distinct seats: $DISTINCT"
echo

if [[ "$EX_OK" -eq "$CAPACITY" && "$ASSIGNMENTS" -eq "$DISTINCT" ]]; then
  echo "PASS — flight sold out exactly once, every seat distinct."
else
  echo "FAIL — expected $CAPACITY successes with all-distinct seats."
  exit 1
fi
