#!/usr/bin/env bash
# Creates (or resets) a large flight used only by the k6 load tests.
#
# WHY THIS EXISTS: the demo flights hold 36 seats each, 216 in total. A booking
# load test would exhaust every seat in a couple of seconds and then spend the
# rest of the run measuring the "sold out" rejection path — which is a real code
# path, but not the one the test is trying to measure. A large pool keeps the
# contended-write path exercised for the whole run.
#
# Seat count is deliberately consistent across BOTH databases: aircraft_capacity
# in flights_db must match the number of flight_seats rows in bookings_db. No
# foreign key can enforce that across databases, so the script sets both.
#
# Safe to re-run — it resets the flight to fully available and clears the
# bookings made against it by previous runs.
set -uo pipefail

FLIGHT_ID="${FLIGHT_ID:-999}"
SEATS="${SEATS:-5000}"
PG="docker exec -i airline-postgres"

echo "resetting load-test flight $FLIGHT_ID with $SEATS seats"

# --- bookings_db: seat inventory (the authoritative side) --------------------
$PG env PGPASSWORD=bookings_dev_pw psql -U bookings_svc -d bookings_db -q <<SQL
-- Remove assignments from previous runs so seats are free again. Only ever
-- touches the load-test flight; real demo data is untouched.
DELETE FROM booking_seats
 WHERE flight_seat_id IN (SELECT id FROM flight_seats WHERE flight_id = $FLIGHT_ID);

DELETE FROM bookings WHERE flight_id = $FLIGHT_ID;

INSERT INTO flight_seats (flight_id, seat_number, status, version, updated_at)
SELECT $FLIGHT_ID, 'L' || g, 'available', 0, now()
  FROM generate_series(1, $SEATS) AS g
    ON CONFLICT (flight_id, seat_number)
    DO UPDATE SET status = 'available', version = flight_seats.version + 1, updated_at = now();
SQL

# --- flights_db: the read model --------------------------------------------
$PG env PGPASSWORD=flights_dev_pw psql -U flights_svc -d flights_db -q <<SQL
INSERT INTO flights (id, flight_number, origin_code, destination_code,
                     departure_time, arrival_time,
                     aircraft_capacity, seats_available, price_cents, created_at)
VALUES ($FLIGHT_ID, 'LOAD1', 'BOM', 'DEL',
        '2026-12-01T06:00:00Z', '2026-12-01T08:10:00Z',
        $SEATS, $SEATS, 500000, now())
    ON CONFLICT (id)
    DO UPDATE SET aircraft_capacity = $SEATS, seats_available = $SEATS;
SQL

echo "ready:"
$PG env PGPASSWORD=bookings_dev_pw psql -U bookings_svc -d bookings_db -t -c \
  "SELECT '  bookings_db: ' || count(*) || ' seats, ' || count(*) FILTER (WHERE status='available') || ' available' FROM flight_seats WHERE flight_id = $FLIGHT_ID;"
$PG env PGPASSWORD=flights_dev_pw psql -U flights_svc -d flights_db -t -c \
  "SELECT '  flights_db:  capacity ' || aircraft_capacity || ', seats_available ' || seats_available FROM flights WHERE id = $FLIGHT_ID;"