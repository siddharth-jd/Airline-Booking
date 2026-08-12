import http from 'k6/http';
import { check } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';

// =============================================================================
// WRITE PATH — the contended one.
//
// Every request here opens a transaction, takes row locks, does a
// compare-and-swap, writes three tables and an outbox row, then commits. This
// is the expensive path, and the one the whole project exists to make correct.
//
// THE IMPORTANT SUBTLETY: a 409 is NOT a failure.
//
// "Seat already taken" and "insufficient seats" are correct, deliberate business
// responses — under contention they are the system WORKING. k6 counts any
// non-2xx as a failed request by default, so a naive version of this test would
// report a huge failure rate while the system behaved perfectly, and the
// thresholds would be meaningless.
//
// setResponseCallback below tells k6 that 409 is an expected outcome. Conflicts
// are then tracked as their own metric, which is the number actually worth
// looking at: it says how much real contention the run produced.
//
// Run:  ./scripts/loadtest.sh booking
// =============================================================================

const BASE = __ENV.BASE_URL || 'http://nginx';
const FLIGHT_ID = Number(__ENV.FLIGHT_ID || 999);

const bookingLatency = new Trend('booking_latency', true);
const bookingsCreated = new Counter('bookings_created');
const conflicts = new Counter('booking_conflicts');
const conflictRate = new Rate('booking_conflict_rate');

// 409 is an expected response, not an error. Without this, http_req_failed
// would treat correct behaviour under contention as failure.
http.setResponseCallback(http.expectedStatuses(200, 201, 409));

export const options = {
  // Report p99 as well as p95 — the tail is where contention shows up, and an
  // average hides it completely.
  summaryTrendStats: ['min', 'med', 'avg', 'p(90)', 'p(95)', 'p(99)', 'max'],

  stages: [
    { duration: '10s', target: 10 },
    { duration: '30s', target: 30 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    // Writes are allowed to be slower than reads — they take locks and commit.
    // These are still assertions: exceed them and the run fails.
    'http_req_duration{expected_response:true}': ['p(95)<800', 'p(99)<1500'],
    // Only genuine errors count here now that 409 is expected. Anything above
    // zero means 5xx responses, timeouts or dropped connections.
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

export function setup() {
  // One login for the whole run. Authentication is not what is being measured,
  // and re-logging in per iteration would put bcrypt (~450ms) in the hot path
  // and dominate every number in the report.
  const email = `loadtest-${Date.now()}@example.com`;
  const password = 'load test password';

  http.post(
    `${BASE}/auth/signup`,
    JSON.stringify({ email, password }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  const res = http.post(
    `${BASE}/auth/login`,
    JSON.stringify({ email, password }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  if (res.status !== 200) {
    throw new Error(`setup failed to obtain a token: HTTP ${res.status} ${res.body}`);
  }
  return { token: res.json('token') };
}

export default function (data) {
  // A UNIQUE key per request. These are competing clients, not retries — if
  // they shared a key, idempotency would collapse them into one booking and the
  // seat-locking path would never be exercised at all.
  const idempotencyKey = `k6-${__VU}-${__ITER}-${Date.now()}`;

  const res = http.post(
    `${BASE}/bookings`,
    JSON.stringify({ flight_id: FLIGHT_ID, seat_count: 1 }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${data.token}`,
        'Idempotency-Key': idempotencyKey,
      },
      tags: { name: 'POST /bookings' },
    }
  );

  bookingLatency.add(res.timings.duration);
  conflictRate.add(res.status === 409);

  if (res.status === 201) bookingsCreated.add(1);
  if (res.status === 409) conflicts.add(1);

  check(res, {
    'created or legitimately conflicted': (r) => r.status === 201 || r.status === 409,
    'no server error': (r) => r.status < 500,
    'created bookings return seats': (r) => {
      if (r.status !== 201) return true;
      try {
        return Array.isArray(r.json('seats')) && r.json('seats').length === 1;
      } catch {
        return false;
      }
    },
  });
}