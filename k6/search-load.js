import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';

// =============================================================================
// READ PATH — flight search.
//
// Measures the cheap, cacheable, high-volume half of the system: a query hitting
// an indexed range scan and returning a small result set. Nothing here contends
// for locks, so this establishes the FLOOR — the latency the system has when
// concurrency control is not involved at all.
//
// That floor is what makes the booking numbers meaningful. p99 of 40ms on a
// write path is unimpressive without knowing a read costs 5ms, and alarming if a
// read costs 35ms.
//
// Run:  ./scripts/loadtest.sh search
// =============================================================================

const BASE = __ENV.BASE_URL || 'http://nginx';

const searchLatency = new Trend('search_latency', true);

export const options = {
  // Report p99 as well as p95 — the tail is where contention shows up, and an
  // average hides it completely.
  summaryTrendStats: ['min', 'med', 'avg', 'p(90)', 'p(95)', 'p(99)', 'max'],

  // Ramp up, hold, ramp down. The hold is where the numbers come from — the
  // ramps exist so the system is not judged on its cold-start behaviour, and so
  // connection pools and the JIT have settled.
  stages: [
    { duration: '10s', target: 20 },
    { duration: '30s', target: 50 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    // A threshold is a PASS/FAIL assertion, not a decoration. If p95 exceeds
    // 200ms or more than 1% of requests fail, k6 exits non-zero and the run is
    // a failure. Numbers without thresholds are just trivia.
    'http_req_duration{expected_response:true}': ['p(95)<200', 'p(99)<500'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

const ROUTES = [
  { origin: 'BOM', destination: 'DEL', date: '2026-09-01' },
  { origin: 'DEL', destination: 'BOM', date: '2026-09-01' },
  { origin: 'BLR', destination: 'DEL', date: '2026-09-01' },
  { origin: 'MAA', destination: 'BOM', date: '2026-09-02' },
];

export default function () {
  const route = ROUTES[Math.floor(Math.random() * ROUTES.length)];
  const url = `${BASE}/flights?origin=${route.origin}&destination=${route.destination}&date=${route.date}`;

  const res = http.get(url, { tags: { name: 'GET /flights' } });
  searchLatency.add(res.timings.duration);

  check(res, {
    'status is 200': (r) => r.status === 200,
    'returns a flights array': (r) => {
      try {
        return Array.isArray(r.json('flights'));
      } catch {
        return false;
      }
    },
  });
}