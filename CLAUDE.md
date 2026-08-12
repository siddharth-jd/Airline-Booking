# Airline Booking System — project context

## What this is

A microservices airline booking backend, built to back this resume entry:

> **Airline Booking System | Microservices | Self-Project (2025)**
> - Developed microservices backend for **Flights**, **Bookings**, & **Auth** using Node.js, Express, Sequelize with PostgreSQL
> - Designed **normalized schemas** and implemented **cross-service associations** to support booking workflows
> - Built **idempotent booking APIs** with **concurrency control** and **transactions** to prevent double booking
> - Integrated **Kafka** for async notifications and **real-time availability updates**, ensuring eventual consistency
> - **Dockerized** services, configured **Nginx** as reverse **API gateway** & performed **k6** load testing for scalability

Reference image of the bullet: `C:\Users\jishn\OneDrive\Desktop\airline\airlinr_booking_system.png`

## The actual goal — read this before anything else

The code is **not** the deliverable. The deliverable is Jishnu being able to defend
every claim above in a deep technical interview. The stated benchmark is questions like:

- Why Kafka instead of RabbitMQ?
- What happens if the consumer fails?
- What delivery semantics are you using?
- What happens if a booking request is retried?
- How did you prevent double booking?
- Where is the transaction boundary?
- What does idempotency mean in your API?
- How did your concurrency control work?
- Why PostgreSQL instead of MongoDB?
- Why microservices instead of a monolith?

**Nothing goes into this project that cannot be explained.** No feature added for
keyword value. If a technology earns its place, the reasoning gets recorded in
`DECISIONS.md`; if it cannot be justified, it does not get built.

## Timeline

- **~4 days** to build (then a second, different project follows).
- **~3 months** to learn the underlying theory, in parallel, with teaching happening
  alongside the build.

## Who I'm working with

Jishnu — IIT Bombay, mechanical engineering background, moving toward software.
Has coursework in OS, OOP, DSA, and some web dev on his machine.

Self-assessed starting point, which should be taken at face value:

- **Comfortable:** terminal, Linux basics, git. (Last used Ubuntu ~3 years ago,
  so re-orientation help is welcome but he is not afraid of a shell.)
- **Does not know:** JavaScript/Node, SQL/databases, Docker, Kafka, backend
  architecture.

### How to teach here

- **SQL gets taught explicitly, not absorbed.** The core of this project —
  transactions, isolation levels, row locks, the double-booking invariant — *is*
  SQL. He cannot understand the project without understanding it.
- **JavaScript is taught line by line as we build.** No prior JS.
- **Explain the terrain before making decisions on it.** An early mistake in this
  project was diving into architecture before explaining what WSL was and where
  files lived. Do not repeat it. Concepts land before the code that uses them.
- He was explicitly told: stop me whenever something appears you can't explain back
  to yourself. Honour that — encourage the interruptions, never rush past them.
- Build approach chosen: **straight build, correct from the start** (he was offered
  a deliberately-broken-first approach and declined it, for deadline reasons).
  The demo endpoint now exists as `POST /demo/unsafe-bookings`.
- **Pace preference, stated during the build:** keep explanations to a short table
  or a few bullets per step and keep moving — do not stop for approval before
  routine execution (running a migration, creating a directory). He pushed back
  on both extremes: skipping explanation entirely means "i will get nothing", but
  full lessons before each step cost too much time against the deadline.
- **Learning SQL in parallel from a MySQL-based course** (Apna College, 3-hour
  video). Practice happens against Postgres instead, in a sandbox `practice_db`
  with its own `practice` role that has no access to the project databases.
  `db/PRACTICE.md` holds the MySQL→PostgreSQL translation table (`SHOW TABLES`
  → `\dt`, `USE db` → `\c db`, `AUTO_INCREMENT` → `SERIAL`, …) and a psql
  reference. Expect MySQL-vs-Postgres translation questions; answer them against
  that file. He chose the terminal (`psql`) over a GUI.

## Environment

Everything lives inside **WSL2 / Ubuntu 22.04**, not on the Windows filesystem.

| | |
|---|---|
| Project path (Linux) | `/home/jishnu747/projects/airline-booking` |
| Project path (from Windows) | `\\wsl.localhost\Ubuntu-22.04\home\jishnu747\projects\airline-booking` |
| Desktop shortcut | `airline-booking (project files).lnk` |
| Node | v24.19.0 (via nvm) |
| npm | 11.17.0 |
| Docker Engine | 29.7.2 (native in WSL — **not** Docker Desktop) |
| Docker Compose | 5.4.0 |
| PostgreSQL | 17.10, in a container |

Notes for tooling:

- `sudo` in WSL requires a password (it was reset early on; he knows it now).
  Long `sudo` blocks should be preceded by a standalone `sudo -v`, otherwise
  pasted lines get consumed by the password prompt.
- nvm is loaded from **both** `~/.bashrc` and `~/.profile`. The `.profile` entry was
  added deliberately so `bash -lc "node ..."` works from automation — Ubuntu's
  `.bashrc` returns early for non-interactive shells.
- The project is deliberately **outside OneDrive**; `node_modules` in a synced
  folder causes sync conflicts and locked files.

## Architecture decisions so far

Full reasoning lives in `DECISIONS.md`. Summary:

1. **Seat inventory lives in the Booking service**, not the Flight service.
   Service boundaries follow *transactional* boundaries, not nouns. The
   one-seat-one-booking invariant needs a single local ACID transaction; splitting
   it would force a saga to solve a self-inflicted problem. The Flight service
   holds an eventually-consistent read model of availability, fed by Kafka.
2. **Money is integer cents**, never floats.
3. **One Postgres instance, four databases** (`auth_db`, `flights_db`,
   `bookings_db`, `notifications_db`), each with its own login role, `CONNECT`
   revoked from `PUBLIC`.
   Cross-service reads are physically impossible, so "no shared tables" and "no
   foreign keys across services" are enforced rather than promised.

## Current status

Done:
- WSL toolchain installed and verified (Node, Docker, Compose, git).
- Repo initialised at `~/projects/airline-booking`.
- `docker-compose.yml` — PostgreSQL 17 with named volume, healthcheck, init mount.
- `db/init/00-init-databases.sql` — four roles, four databases, isolation grants.
  `db/init/01-practice-database.sql` — a `practice_db` sandbox for learning SQL.
- Postgres running and healthy; isolation verified (`auth_svc` connecting to
  `bookings_db` correctly fails with "permission denied ... does not have CONNECT
  privilege").
- `.gitignore`, `DECISIONS.md`, Desktop shortcut, this file.
- Normalised schemas designed and loaded live against all databases:
  - `auth_db`: `users` (email uniqueness enforced at the DB level).
  - `flights_db`: `airports`, `flights` (real FKs — same database; `seats_available`
    is an eventually-consistent read model, to be fed by Kafka later).
  - `bookings_db`: `flight_seats` (status + `version` column for optimistic
    concurrency), `bookings`, `booking_seats` (partial unique index on
    `(flight_seat_id) WHERE cancelled_at IS NULL` — the DB-level double-booking
    backstop), `idempotency_keys`, `outbox` (transactional outbox, relayed to
    Kafka by `src/relay.js`).
  - `notifications_db`: `notifications`, keyed by `event_id` so the table is its
    own inbox.
  - Reference dumps committed at `db/schema/{auth,flights,bookings}_db.sql`
    (`pg_dump --schema-only`, regenerate after any live schema change).
- **Auth service** (`services/auth/`, port 4001) — Express + Sequelize.
  `POST /auth/signup`, `POST /auth/login`, `GET /health`. bcrypt cost 12, JWT
  signed with a shared `JWT_SECRET`. Duplicate email → 409 (backed by the DB
  `UNIQUE` constraint, not an app-level pre-check); bad password and unknown
  email both → generic 401, so the endpoint cannot be used to enumerate
  registered emails. Verified live with curl.
- **Flights service** (`services/flights/`, port 4002) — Express + Sequelize.
  `GET /flights?origin=&destination=&date=`, `GET /flights/:id`, `GET /airports`,
  `GET /health`. Search is a half-open UTC day range (`>= day, < day+1`) and
  `EXPLAIN` confirms it uses `idx_flights_route_time`. Seeder provides 4 airports
  and 6 flights. Verified live with curl.
- **Booking service** (`services/bookings/`, port 4003) — the core. Express +
  Sequelize. `POST /bookings` (requires `Idempotency-Key`), `GET /bookings`,
  `GET /bookings/:id`, `GET /health`. JWT verified locally with the shared
  secret — no call back to the auth service, no read access to `auth_db`.
  - Three independent double-booking defences: `SELECT ... FOR UPDATE`,
    optimistic `version` compare-and-swap, and the partial unique index. See
    DECISIONS.md 004.
  - Two lock modes: `FOR UPDATE` for specific seats, `FOR UPDATE SKIP LOCKED`
    for "any n seats". Specific-seat locks taken `ORDER BY id` to avoid deadlock.
  - Idempotency key claimed in its own transaction that commits *before* the
    booking work, so concurrent retries can see it. Scoped by `user_id` and
    fingerprinted by request body. See DECISIONS.md 005.
  - Outbox row written in the same transaction as the booking, relayed to Kafka
    by `src/relay.js`.
  - `POST /bookings/:id/cancel` — releases seats, stamps `booking_seats
    .cancelled_at`, emits `booking.cancelled`. Requires **no** idempotency key:
    cancellation is naturally idempotent, so repeats return the same 200. Locks
    the booking row `FOR UPDATE` so concurrent cancels serialise — verified with
    10 simultaneous requests releasing seats exactly once. See DECISIONS.md 017.
  - `POST /demo/unsafe-bookings` — the same flow with all concurrency control
    removed, so the race is demonstrable. Mounted only when
    `ENABLE_UNSAFE_DEMO=true`.
- Schemas in all three services are now owned by **Sequelize migrations**
  (`npm run migrate`), not hand-written SQL. The hand-built tables were dropped
  and recreated through migrations so the schema is reproducible from the repo.
- `scripts/services.sh` — start/stop/restart/status for all three services.
  Identifies processes by working directory, because all three run the identical
  command `node src/index.js` and `pkill` on that pattern kills all of them.
- **Kafka** (KRaft mode, no ZooKeeper) in `docker-compose.yml`, topic
  `booking-events` with 3 partitions, created by `scripts/kafka-setup.sh`
  (broker auto-topic-creation is off on purpose). Events are keyed by
  `flight_id` so each flight's events stay ordered within one partition.
- **Outbox relay** (`services/bookings/src/relay.js`, `npm run relay`) — claims
  unpublished outbox rows with `FOR UPDATE SKIP LOCKED`, publishes, then marks
  them published. That order gives at-least-once delivery: a crash between
  publish and mark republishes rather than losing the event.
- **Flights consumer** (`services/flights/src/consumer.js`, `npm run consumer`) —
  applies `booking.confirmed` / `booking.cancelled` to `flights.seats_available`,
  which is now a genuine live read model rather than a placeholder. Every event
  id is recorded in `processed_events` (the inbox) in the same transaction as
  the effect, so redelivery is a no-op. See DECISIONS.md 007 and 008.
- Verified end to end: booking 4 seats in the booking service moved the flights
  service's `seats_available` from 36 to 32 with no synchronous call between
  them. With the consumer killed, bookings kept succeeding and the read model
  went stale, then caught up exactly on restart. Resetting consumer offsets to
  replay every event logged them all as `duplicate` and left `seats_available`
  unchanged.
- **Notifications service** (`services/notifications/`, `npm run consumer`) — a
  fourth service with its own database, consuming the same `booking-events`
  topic in a *different* consumer group. Adding it required zero changes to the
  booking service, which is the concrete payoff of choosing a log over a queue.
  `notifications.event_id` is the primary key, so it is its own inbox: verified
  by resetting offsets and replaying every event with zero duplicate messages.
  **Delivery is simulated** — written to `.logs/notifications-sent.log`, not
  emailed. See DECISIONS.md 015.
- **Seed data coupling, unenforceable by design:** `AIRCRAFT_CAPACITY` in the
  flights seeder must equal the seat count in the bookings seeder (both 36).
  Different databases, so no foreign key can catch a mismatch — it surfaces only
  as search advertising seats on a sold-out flight. Comments in both seeders
  point at each other.
- **Containerised stack** — all four services have multi-stage Dockerfiles
  (`migrator` stage keeps sequelize-cli, `runtime` stage is `--omit=dev`, runs as
  non-root). Migrations run as one-shot jobs; app services wait on
  `service_completed_successfully`. **Nginx (`nginx/nginx.conf`) on port 8080 is
  the only thing published to the host** — services have no host port mapping and
  are reachable solely by name on the internal network. Verified unreachable
  directly. See DECISIONS.md 018.
- **Two deployment modes, both working:**
  - containers: `docker compose up -d`, everything via `http://localhost:8080`
  - host dev: `./scripts/services.sh start`, direct ports 4001-4003
  - Do not run both at once — they share Kafka consumer groups and would fight
    over partition assignment.
- `scripts/concurrency-test.sh` — the correctness proof, now run **through the
  gateway** by default (override with `AUTH_URL`/`BOOKINGS_URL` for host mode).
  Measured results:
  - 30 concurrent requests for one seat → **1** success, 29 × 409, 1 active
    assignment in the database.
  - 40 concurrent "any seat" against 36 free → **36** successes, 4 × 409, all
    36 seats distinct.
  - The same race against the unsafe endpoint → **5 bookings for one seat**.
- **k6 load tests** (`k6/`, `./scripts/loadtest.sh {search|booking|all}`) — run
  as a container on the compose network, through the gateway. Measured:
  - search: 54,570 reqs @ 1212/s, 0.000% failed, p95 44ms, p99 57ms
  - booking: 10,331 reqs @ 215/s, 0.000% failed, p95 129ms, p99 176ms
  - **5,000 seats → 5,000 booked → 0 sold twice** under sustained load
  - Found a real gateway bug: `proxy_http_version 1.1` without an upstream
    `keepalive` directive caused 11.22% 502s while the app logged nothing.
    Fixing it removed all failures, raised throughput 73% and halved p95.
    See DECISIONS.md 019.
  - `scripts/loadtest-seed.sh` creates flight 999 with 5,000 seats, because the
    demo flights (216 total) sell out in seconds.

Convention established for every service: `config/config.js` reads from `.env`
(never a committed `config.json`), `.sequelizerc` points Sequelize at it, and
`models/index.js` is patched to require the `.js` config.

Not yet done — nothing is committed to git; `git config user.name/user.email`
were never set. That is the immediate next housekeeping step.

**Every claim in the resume bullet is now built, working and measured.**

### Optional, if the bullet keeps the word "real-time"

1. SSE for genuine real-time availability. Kafka does not reach a browser, so as
   written the phrase describes server-to-server propagation, not a live UI. A
   second consumer group on `booking-events` feeding an SSE endpoint is the
   shape. Alternative: soften the bullet to "availability updates" and skip it —
   defensible either way, but not both.
2. Refresh-token / RS256 work (DECISIONS.md 013 records both as real gaps).

## Useful commands

```bash
cd ~/projects/airline-booking

docker compose down           # stop (data survives)
docker compose down -v        # stop AND wipe data (re-runs db/init scripts)

# open a SQL shell as a service role
docker exec -it -e PGPASSWORD=bookings_dev_pw airline-postgres \
  psql -U bookings_svc -d bookings_db

# MODE 1 — containerised (everything through the gateway on :8080)
docker compose up -d              # build+start all 13 containers
docker compose ps                 # status + health
docker compose logs -f bookings
curl http://localhost:8080/health # the gateway

# MODE 2 — host dev (faster iteration, direct ports 4001-4003)
# Stop mode 1 first: the two share Kafka consumer groups.
./scripts/services.sh start        # or: stop | restart | status
./scripts/services.sh restart bookings
./scripts/services.sh logs consumer

# Kafka
./scripts/kafka-setup.sh                    # create topics (idempotent)
docker exec airline-kafka /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server localhost:9092 --list
docker exec airline-kafka /opt/kafka/bin/kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 --topic booking-events --from-beginning

# concurrency correctness proof (defaults to the gateway on :8080)
./scripts/concurrency-test.sh
AUTH_URL=http://localhost:4001 BOOKINGS_URL=http://localhost:4003 \
  ./scripts/concurrency-test.sh    # host mode

# k6 load tests (containerised k6 on the compose network, via the gateway)
./scripts/loadtest.sh search      # read path
./scripts/loadtest.sh booking     # contended write path (reseeds flight 999)
./scripts/loadtest.sh all
# summaries land in .logs/loadtest/*.json

# schema changes go through migrations, never hand-written SQL
npm run migrate               # apply pending migrations
npm run migrate:undo          # roll back the most recent one
npm run seed                  # flights service only — demo airports + flights
```

Local-dev credentials (committed on purpose, not secrets):
`auth_svc/auth_dev_pw`, `flights_svc/flights_dev_pw`, `bookings_svc/bookings_dev_pw`,
`notifications_svc/notifications_dev_pw`, `practice/practice_pw`,
superuser `postgres/postgres`.
