# Airline Booking System

A microservices backend for booking flight seats, built around one hard problem:

> **Two people tap "book seat 14A" at the same instant. Exactly one may get it.**

Naive code sells that seat twice. This system defends against it three
independent ways, and the proof is measured rather than claimed — 10,331
concurrent booking attempts against 5,000 seats produced exactly **5,000
bookings and zero double-sales**.

```bash
git clone <this repo> && cd airline-booking
docker compose up -d        # builds and starts everything
./scripts/demo.sh           # guided walkthrough of the whole system
```

Then open **http://localhost:8080** for the web client.

That is the whole setup. `docker compose up -d` also creates the Kafka topic,
applies every migration and seeds demo data, so the stack comes up populated and
working with no manual steps. Verified from a completely empty state
(`docker compose down -v`) — nothing else to install but Docker.

---

## What it does

Four services, each owning its own database, communicating over HTTP for
queries and Kafka for events.

| Service | Port | Owns | Responsibilities |
|---|---|---|---|
| **auth** | 4001 | `auth_db` | Signup, login, JWT issuance (bcrypt cost 12) |
| **flights** | 4002 | `flights_db` | Flight search, airports, availability read model |
| **bookings** | 4003 | `bookings_db` | **Seat inventory, booking, cancellation** |
| **notifications** | — | `notifications_db` | Booking confirmations (simulated delivery) |

Plus an outbox relay and two Kafka consumers as separate worker processes, and
**Nginx as the single public entry point** — the services publish no host ports
and are unreachable from outside the Docker network.

```
                    ┌──────────────────────────────┐
   browser ────────▶│  Nginx  :8080  (only public) │
                    └───┬──────────┬──────────┬────┘
                        │          │          │
                  ┌─────▼───┐ ┌────▼─────┐ ┌──▼────────┐
                  │  auth   │ │ flights  │ │ bookings  │
                  └────┬────┘ └────▲─────┘ └─────┬─────┘
                       │           │             │
                  ┌────▼────┐ ┌────┴─────┐  ┌────▼─────┐
                  │ auth_db │ │flights_db│  │bookings_db│
                  └─────────┘ └────▲─────┘  └────┬─────┘
                                   │             │ outbox row
                              consumer           │ (same transaction)
                                   │        ┌────▼─────┐
                                   └────────┤  Kafka   │◀── relay
                                            └────┬─────┘
                                                 │
                                        ┌────────▼────────┐
                                        │  notifications  │
                                        └─────────────────┘
```

---

## The core problem, and the three defences

Seat inventory lives in the **booking** service, not the flight service —
because service boundaries should follow *transactional* boundaries, not nouns.
The one-seat-one-booking invariant needs a single local ACID transaction;
splitting it across services would force a distributed saga to solve a
self-inflicted problem.

Inside that transaction, three independent mechanisms:

1. **Pessimistic row locks** — `SELECT … FOR UPDATE` on the seat rows. A second
   transaction touching the same seat blocks until the first commits.
2. **Optimistic compare-and-swap** — `UPDATE … WHERE id = ? AND version = ?`,
   with `RETURNING id` to confirm a row actually matched.
3. **A partial unique index** — `UNIQUE (flight_seat_id) WHERE cancelled_at IS NULL`.

**Why three?** They fail differently, and only the third survives a bug in the
code above it. Locks and CAS are application logic — a future endpoint that
forgets to take the lock silently reintroduces the race. The index is in the
schema and cannot be forgotten. It is *partial* so cancellation history
survives: a cancelled row drops out of the index, freeing the seat for rebooking
without deleting the audit trail.

Two lock modes, chosen by intent:

- `FOR UPDATE` when **specific** seats were requested — no substitute will do,
  so waiting is correct.
- `FOR UPDATE SKIP LOCKED` when **any *n*** seats will do — a locked row is
  useless to us, and waiting for it is pointless while other seats are free.
  This is what stops a lock convoy forming under load.

---

## Measured results

Everything below is reproducible with the scripts in this repo.

### Correctness

```
./scripts/concurrency-test.sh

30 concurrent requests, same seat   →  1 × 201, 29 × 409, 1 active assignment
40 concurrent "any seat", 36 free   →  36 × 201, 4 × 409, 36 DISTINCT seats
```

`POST /demo/unsafe-bookings` runs the same flow with all three defences removed.
The same race against it produces **5 confirmed bookings for one seat** — the bug
is preserved deliberately so it can be demonstrated rather than described.

### Performance

```
./scripts/loadtest.sh all      # k6, through the gateway

SEARCH   54,570 reqs @ 1212/s   0.000% failed   p95  44ms   p99  57ms
BOOKING  10,331 reqs @  215/s   0.000% failed   p95 129ms   p99 176ms
         5,000 created · 5,329 legitimate 409s
```

Under that sustained load: **5,000 seats · 5,000 booked · 5,000 distinct · 0 sold
twice.** The event pipeline kept pace — 5,046 outbox rows published with none
pending, 5,046 consumed, 5,046 notifications.

> These numbers are a baseline and regression guard **on one laptop**, where k6
> competes with the stack for CPU and every service runs a single replica. They
> are not capacity figures for a real deployment.

Load testing earned its place immediately: the first run showed **11.22% of
requests failing with 502** while the application logged nothing and every
container reported healthy. The fault was a missing `keepalive` directive in the
nginx upstream blocks. Fixing it removed all failures, raised throughput 73% and
halved p95.

---

## Idempotency

`POST /bookings` requires an `Idempotency-Key` header. The key is the primary key
of a table, and the row is claimed **in its own transaction that commits before
any booking work begins** — so a concurrent retry can see it. Two simultaneous
retries race on the primary key; one wins, the loser reads the winner's row.

Keys are scoped per user and fingerprinted by request body, so reusing one key
for a genuinely different request returns `422` rather than silently replaying
the wrong response.

`POST /bookings/:id/cancel` requires **no** key, and the contrast is the point:
creating a booking is not naturally idempotent ("book me a seat" twice
legitimately means two seats), while cancelling reaches the same end state
however many times it runs. Ask whether an operation is *already* idempotent
before adding machinery to make it so.

---

## Events and delivery semantics

A booking must both commit to Postgres and announce itself to Kafka, atomically.
Those are different systems with no shared transaction, so the event is written
as a **row in an outbox table inside the same transaction as the booking**. A
relay publishes it afterwards.

The relay **publishes, then marks published**. A crash between those two steps
republishes rather than losing the event — **at-least-once** delivery. The
reverse order would trade duplicates for silent data loss, which is strictly
worse: a duplicate can be absorbed, a lost event cannot be recovered.

So every consumer records each `event_id` in an **inbox table, in the same
transaction that applies the event's effect**. Replay then becomes a no-op.
Verified by resetting consumer offsets to zero and redelivering every event:
all logged as `duplicate`, `seats_available` unchanged, zero extra notifications.

**Why Kafka and not RabbitMQ?** A queue deletes on consumption; a log retains.
The notifications service was added later as a second consumer group and
required **zero changes to the booking service** — no new endpoint, no extra
publish, no config. With a queue, one consumer taking a message means the other
never sees it. Retention also makes the read model rebuildable by replay, which
is literally how the idempotency test above was run.

RabbitMQ would work perfectly well at this scale; it is the better tool for
work-queue patterns. The requirement here is a durable, replayable,
multi-subscriber event stream, which is Kafka's shape.

---

## Running it

Requires Docker and Docker Compose. Nothing else installs on your machine.

```bash
docker compose up -d              # build and start everything
docker compose ps                 # status and health
curl http://localhost:8080/health # the gateway
docker compose down               # stop (data survives)
docker compose down -v            # stop AND wipe all data
```

| Command | What it does |
|---|---|
| `./scripts/demo.sh` | Guided ten-step walkthrough of the whole system |
| `./scripts/concurrency-test.sh` | The double-booking proof |
| `./scripts/loadtest.sh all` | k6 load tests, through the gateway |
| `./scripts/kafka-setup.sh` | Create Kafka topics (idempotent) |
| `./scripts/services.sh start` | Run on the host instead of in containers, for faster iteration |

Local-development credentials are committed on purpose so the stack starts with
one command. Nothing in this repository is a real secret.

### API

```
POST /auth/signup                 {email, password}
POST /auth/login                  {email, password} → {token}

GET  /airports
GET  /flights?origin=&destination=&date=
GET  /flights/:id
GET  /flights/:id/seats           seat-level availability

POST /bookings                    requires Idempotency-Key + Bearer token
GET  /bookings                    the caller's bookings
GET  /bookings/:id
POST /bookings/:id/cancel         no idempotency key needed
```

---

## What is deliberately not built

Stated plainly, because a project that hides its gaps is harder to defend than
one that names them:

- **No payment processing.** Bookings record an amount; nothing charges a card.
- **Notification delivery is simulated** — written to `.logs/notifications-sent.log`,
  not emailed. The pipeline is real; the SMTP plumbing is not.
- **JWTs cannot be revoked** before expiry, and the shared HS256 secret lets any
  service *mint* tokens rather than only verify them. RS256 and refresh tokens
  are the correct fixes and are not implemented.
- **One replica of everything**, no TLS, secrets in the compose file.
- **An idempotency key can wedge** if the process crashes mid-request; a
  production system leases claims with an expiry.
- **`processed_events` grows without bound** — it needs periodic pruning.

---

## Reading the code

- **[`DECISIONS.md`](DECISIONS.md)** — 19 entries: what was chosen, why, what was
  rejected, and what it cost. Start here.
- **[`LEARNING.md`](LEARNING.md)** — what to learn, in order, mapped to the
  specific files each topic explains.
- **[`db/PRACTICE.md`](db/PRACTICE.md)** — SQL practice sandbox and a
  MySQL→PostgreSQL translation table.

The interesting files, in order:

| File | Why |
|---|---|
| [`services/bookings/src/services/bookingService.js`](services/bookings/src/services/bookingService.js) | The heart — transaction boundary, both lock modes, the CAS |
| [`services/bookings/src/routes/unsafe.js`](services/bookings/src/routes/unsafe.js) | The same flow with the safety removed, preserved to demonstrate the bug |
| [`services/bookings/src/services/idempotency.js`](services/bookings/src/services/idempotency.js) | Why the key is claimed before the work starts |
| [`services/bookings/src/relay.js`](services/bookings/src/relay.js) | Publish-then-mark, and why that order is deliberate |
| [`services/flights/src/consumer.js`](services/flights/src/consumer.js) | Applying an event idempotently via the inbox |

---

## Stack

Node.js · Express · Sequelize · PostgreSQL 17 · Apache Kafka 3.9 (KRaft, no
ZooKeeper) · Nginx · Docker Compose · k6