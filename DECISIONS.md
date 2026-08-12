# Decision Log

Every non-obvious choice in this project: **what**, **why**, **what I rejected**,
and **what it cost me**.

This file exists because a resume bullet you cannot defend is worse than no bullet
at all. When an interviewer asks "why did you use X?", the answer lives here — and
if a decision has no honest entry, that is a signal the decision was made for
keyword value and should be reconsidered or removed.

---

## 001 — Seat inventory lives in the Booking service, not the Flight service

**What.** `flight_seats` (one row per physical seat per flight) is owned by the
Booking service and lives in `bookings_db`, alongside `bookings`. The Flight
service owns flight *metadata* — schedule, route, aircraft, times — plus a
*derived* view of how many seats are free.

**Why.** The invariant this system exists to protect is "one seat, one booking."
Enforcing an invariant requires that every operation touching it happens inside a
single transaction. If seats lived in the Flight service and bookings in the
Booking service, creating a booking would have to atomically mutate two databases
across a network — a distributed transaction. So seat inventory and the booking
record must live together.

The principle: **service boundaries should follow transactional boundaries, not
nouns.** The naive decomposition — "a flight is a thing, so it gets a service; a
booking is a thing, so it gets a service" — splits an invariant across a network
and manufactures a consistency problem that need not exist. In domain-driven-design
terms the seat and the booking belong to the same *aggregate*, and an aggregate
must not span services.

**Alternative rejected.** Flight service owns seats; Booking service calls it over
HTTP to reserve them. This is legitimate, but it requires a **saga**: a two-phase
`HOLD` → `CONFIRM` state machine on each seat, a compensating transaction to
release holds when payment fails, and a timeout sweeper for holds whose owner
crashed between phases. That is the right pattern when the services genuinely must
be separate — different teams, different scaling profiles, different release
cadences. Here they need not be, so a saga would be complexity paid to solve a
self-inflicted problem.

**What it cost.** The Flight service cannot answer "how many seats are left" from
its own database with strong consistency. It holds a read model updated
asynchronously from Booking events via Kafka, so search results can be **stale** —
it may show 3 seats free when 1 remains. This is the eventual consistency in this
system, and it is confined to a place where staleness is tolerable: search. At the
moment it actually matters, at booking time, the Booking service reads its own data
transactionally and the correct answer wins.

**Stale reads are acceptable. Stale writes are not.**

---

## 002 — One Postgres instance, three databases, three roles

**What.** A single PostgreSQL container hosts `auth_db`, `flights_db`, and
`bookings_db`. Each has its own login role that owns it. `CONNECT` is revoked from
`PUBLIC` and granted only to the owning service.

**Why.** In microservices a service owns its data; no other service reads its
tables directly. This is not bureaucracy — the moment two services share a table,
changing that table requires a coordinated deploy across both, and you have a
*distributed monolith*: every cost of microservices, none of the benefits.

Separate databases with separate roles enforce this at the permission level, so it
cannot be violated by accident or by a careless `JOIN` under deadline pressure. It
also makes "no foreign keys across service boundaries" physically true rather than
a matter of discipline, because Postgres cannot create an FK spanning databases.

Verified, not assumed:

```
$ psql -U auth_svc -d bookings_db
FATAL: permission denied for database "bookings_db"
DETAIL: User does not have CONNECT privilege.
```

**Alternative rejected.** Three separate Postgres *instances*, which is what a real
deployment would run — it gives independent failure domains, independent tuning,
and independent scaling. Rejected because three database servers on a laptop costs
memory and start-up time for no learning benefit: the property that actually
matters here (no service can read another's tables) is fully preserved by roles.

Also rejected: one database with three *schemas*. Weaker isolation, and a shared
connection makes accidental cross-schema joins easy — exactly the failure this
decision is meant to prevent.

**What it cost.** A single point of failure and a single resource pool, which a
production system would not accept. Worth stating plainly in an interview: the
isolation property is real, the deployment topology is a laptop-scale compromise.

---

## 003 — Money is stored as integer cents, never floating point

**What.** All monetary columns are `INTEGER` counts of the smallest currency unit
(`price_cents`), never `FLOAT` / `REAL` / `DOUBLE PRECISION`.

**Why.** Binary floating point cannot exactly represent most decimal fractions:
`0.1 + 0.2` evaluates to `0.30000000000000004` under IEEE 754, which is the format
JavaScript uses for *every* number. Summing seat prices as floats yields totals
wrong by fractions of a cent, and those errors accumulate until reconciliation
fails.

**Alternative rejected.** Postgres `NUMERIC(12,2)` is exact and is the other
correct answer — it is what financial systems typically use. Rejected because
JavaScript has no decimal type, so a `NUMERIC` column arrives in Node either as a
string (requiring a decimal library everywhere) or as a lossy float, which
reintroduces the original problem at the driver boundary. Integers survive the
round trip intact while values stay below 2^53.

**What it cost.** Every price displayed needs an explicit `cents / 100` formatting
step, and currencies with a different minor unit — Japanese yen has none, Kuwaiti
dinar has three decimal places — would need special handling rather than a blanket
divide-by-100.

---

## 004 — Three independent layers prevent double booking

**What.** The one-seat-one-booking invariant is defended three times over, in
`services/bookings/src/services/bookingService.js` and the `booking_seats` schema:

1. **Pessimistic row locks** — `SELECT ... FOR UPDATE` on the seat rows, inside the
   transaction. A second transaction touching the same seat blocks until the first
   commits or rolls back.
2. **Optimistic compare-and-swap** — `UPDATE ... WHERE id = ? AND version = ?`,
   with `RETURNING id` to confirm a row actually matched. If the row moved between
   read and write, zero rows update and the transaction aborts.
3. **A partial unique index** — `UNIQUE (flight_seat_id) WHERE cancelled_at IS NULL`
   on `booking_seats`. At most one *active* assignment per seat, enforced by the
   database itself.

**Why three.** They fail differently, and only the third survives a bug in the code
above it. Locks and CAS are application logic: a future endpoint that forgets to
take the lock silently reintroduces the race. The index cannot be forgotten — it is
in the schema, and it rejects the duplicate `INSERT` no matter which code path
produced it. It is the only layer that is still correct when the other two are
wrong.

The index is *partial* so cancellation history survives: a cancelled assignment sets
`cancelled_at` and drops out of the index, freeing the seat for rebooking without
deleting the audit trail.

**Two lock modes, chosen by intent.** `FOR UPDATE` when specific seats were
requested — no substitute will do, so waiting is correct. `FOR UPDATE SKIP LOCKED`
when the client asked for any *n* seats — a locked row is useless to us and waiting
for it is pointless when other seats are free. Skipping is what stops a lock convoy
forming under load. Specific-seat locks are taken `ORDER BY id`; without a
consistent lock ordering two overlapping requests can deadlock.

**Alternative rejected.** `SERIALIZABLE` isolation, which would make the race
impossible without explicit locks. Rejected because it detects conflicts by aborting
transactions at commit time with `40001`, so every caller needs retry logic, and it
degrades badly under the exact contention this system is built to handle. Explicit
row locks make the contention point visible in the code rather than emergent.

Also rejected: `SELECT ... FOR SHARE`. It permits concurrent readers, which is
precisely the check-then-act window being closed.

**Measured, not assumed.** `./scripts/concurrency-test.sh`:

```
30 concurrent requests, same seat  → 1 × 201, 29 × 409, 1 active assignment
40 concurrent "any seat", 36 free  → 36 × 201, 4 × 409, 36 distinct seats
```

And the same race against `POST /demo/unsafe-bookings`, which has all three layers
removed, produces **5 confirmed bookings for one seat** out of 10 requests. The
endpoint exists so the bug can be demonstrated rather than described.

**What it cost.** Writers on the same seat serialise, so throughput on one
contended seat is bounded by transaction duration. Acceptable: contention is
per-seat, and different seats proceed in parallel — which the 36-distinct-seats
result demonstrates.

---

## 005 — Idempotency is a database row claimed before the work starts

**What.** `POST /bookings` requires an `Idempotency-Key` header. The key is the
primary key of `idempotency_keys`, and the row is inserted **in its own transaction
that commits before any booking work begins**. The stored response is replayed on
any retry.

**Why the claim commits first.** A retry arriving while the original is still
running must be able to *see* the in-progress row. If the claim were part of the
booking transaction it would stay invisible until commit, and both requests would
attempt the booking — the retry would then either double-book or block on seat
locks, converting a cheap duplicate-detection into lock contention.

Two simultaneous retries therefore race on the primary key. Exactly one `INSERT`
wins; the loser gets a unique violation, reads the winner's row, and responds from
it. The uniqueness guarantee comes from the index, not from application checking.

**Beyond a bare key.** The row also stores:

- `user_id` — keys are scoped per user, so a guessed or leaked key cannot return
  someone else's booking.
- `request_fingerprint` — a SHA-256 of the canonical request body. A retry must
  carry the *same* payload; reusing one key for a different request is a client
  bug and returns `422` rather than silently replaying the wrong response.

**Business failures are stored too.** "Seat already taken" is a real, final answer,
so it is recorded and replayed — a retry gets `409` again, not a different outcome.
Infrastructure failures are not stored, because they are not answers; the key is
released so the client can genuinely retry.

**Alternative rejected.** Deriving the key server-side from a hash of the request
body. It cannot distinguish a retry from a deliberate second identical booking —
"book me another seat on the same flight" is a legitimate request that would be
wrongly collapsed. Only the client knows its own intent, so the client supplies
the key.

**Known limitation, stated plainly.** If the process crashes between claiming the
key and completing it, that key stays `in_progress` forever and every retry gets
`409`. A production system leases the claim with an expiry and reclaims stale ones.
Not implemented here; the failure mode is understood rather than hidden.

---

## 006 — The transaction boundary excludes the network call

**What.** `createBooking()` opens the transaction *after* the flight price has been
fetched from the Flights service over HTTP.

**Why.** An open transaction holds row locks and a pooled connection. Making a
network call inside one means a slow or hanging remote service pins both for as
long as it takes — under load the connection pool drains and the whole service
stalls on a dependency it does not control. The call has a 3-second timeout and
happens before any lock is taken.

**What it cost.** The price is read slightly before the booking commits, so a
concurrent price change could book at a marginally stale price. Deliberate: seat
allocation must be strongly consistent, price need not be to the millisecond.

---

## 007 — Kafka rather than RabbitMQ

**What.** Booking events travel over Kafka (single broker, KRaft mode, topic
`booking-events`, 3 partitions) rather than a traditional message broker.

**Why.** The distinction that decided it: **RabbitMQ is a queue, Kafka is a log.**
In RabbitMQ a message is delivered, acknowledged, and *deleted* — consumption is
destructive. In Kafka the event is appended to a retained log and each consumer
group tracks its own offset independently; reading does not remove anything.

Three consequences that matter here:

1. **Multiple independent consumers of the same stream.** The flights read model
   consumes `booking.confirmed` today; a notifications service will consume the
   same events tomorrow, and later an analytics job. In Kafka each is a separate
   consumer group reading the same log at its own pace, with no change to the
   producer. With a queue, adding a second consumer means adding fanout exchanges
   and more queues — the producer's topology grows with every new subscriber.
2. **Replay.** The flights `seats_available` column is a *derived* read model. If
   it is ever corrupted, it can be rebuilt by truncating it and replaying the log
   from offset 0. That was not a theoretical claim — resetting the consumer group
   offsets is exactly how the idempotency test below was run. A queue cannot do
   this: the messages are gone.
3. **Ordering per key.** Kafka guarantees order within a partition, and the
   producer keys each event by `flight_id`, so all events for one flight are
   consumed in the order they were produced. A `booking.confirmed` applied after
   a later `booking.cancelled` would leave the read model permanently wrong.

**Alternative rejected — honestly.** RabbitMQ would work perfectly well at this
scale, and it is the better tool for work-queue patterns: per-message ack,
priorities, dead-letter exchanges, complex routing. If the requirement were "send
one email per booking, retry failures individually", RabbitMQ would be the right
answer and Kafka would be overkill. The requirement here is a durable, replayable,
multi-subscriber event stream feeding a derived read model, which is the shape
Kafka is built for.

**KRaft, not ZooKeeper.** Kafka historically needed a separate ZooKeeper cluster
for metadata. KRaft (production-ready since 3.3) moves that into Kafka's own Raft
quorum, removing a second distributed system to operate. A ZooKeeper container
here would be legacy weight.

**What it cost.** One broker with replication factor 1 is a single point of
failure — if it dies, unpublished events wait in the outbox (safe) but nothing
flows until it returns. Production runs at least three brokers with replication
factor 3 and `min.insync.replicas=2`. Also: Kafka is heavier to run than a queue,
and offset management is a real operational concept to learn rather than a
detail.

---

## 008 — At-least-once delivery, made safe by an inbox table

**What.** The relay publishes and *then* marks the outbox row published. The
consumer records every `event_id` in a `processed_events` table inside the same
transaction that applies the event's effect.

**Why this order.** The relay does three things: claim the row, publish to Kafka,
mark it published. A crash between publishing and marking means the row is still
unpublished and gets published **again** — a duplicate. Doing it the other way
round — mark first, then publish — means a crash loses the event **silently**,
with no record that anything is missing.

That is the whole trade, and it is not symmetric: a duplicate can be absorbed by
an idempotent consumer, a lost event cannot be recovered by anyone. So the design
chooses duplicates and then eliminates their effect at the consumer.

**Why the consumer needs an inbox.** Event effects are usually not naturally
idempotent. `seats_available = seats_available - 1` applied twice is simply wrong,
and nothing in the message reveals it is a repeat. Inserting the `event_id` into
`processed_events` in the *same transaction* as the update makes replay a no-op:
the primary key rejects the duplicate, the transaction aborts, the effect is not
applied twice. Effect and record commit together or not at all — the outbox
pattern mirrored on the receiving side.

**Exactly-once was rejected.** Kafka does offer transactional exactly-once
semantics, but only *within* Kafka (consume→process→produce). The moment the side
effect is a write to Postgres, the guarantee no longer covers it — the write and
the offset commit are in different systems. "Exactly-once" end to end is
effectively at-least-once plus idempotent handling, which is what is built here.
Claiming exactly-once would be claiming something the architecture does not do.

**Measured, not assumed.** Consumer offsets were reset to the beginning, forcing
redelivery of every event:

```
[p0] booking.confirmed event=1 → duplicate
[p0] booking.confirmed event=2 → duplicate
seats_available = 27   (unchanged — it did NOT double-decrement to 18)
```

And with the consumer deliberately stopped: bookings continued to succeed, the
relay kept publishing, the read model went stale, and on restart the consumer
resumed from its committed offset and caught up to the correct value. The booking
path does not depend on the consumer being alive — which is the entire point of
decoupling through a log rather than a synchronous call.

**What it cost.** `processed_events` grows without bound and needs periodic
pruning by age in a real system — not implemented here. And the read model is
eventually consistent: there is a window, typically under a second, where search
shows a seat that is already sold. Acceptable because booking re-checks
transactionally against its own data, so the stale read can never cause a double
booking — only a slightly disappointing search result.

---

## 009 — Node.js and Express

**What.** All three services are Node.js with Express.

**Why Node.** This workload is almost entirely **I/O-bound**: wait for Postgres,
wait for an HTTP call, wait for Kafka. Very little CPU work happens between those
waits. Node's event loop is built for exactly that shape — one thread handles
thousands of concurrent connections because it does something else while each
waits, instead of parking a thread per request.

The secondary reason is honest and practical: JavaScript is one language across
frontend and backend, and it is the language being learned. A stack you cannot
explain is worse than a less fashionable one you can.

**Where Node is the wrong tool, stated plainly.** CPU-bound work blocks the event
loop and stalls every other request on that process. This system has exactly one
such operation — bcrypt (see 012) — which is why the async bcrypt API is used: it
runs on libuv's thread pool rather than the event loop. A synchronous
`bcrypt.hashSync` in a request handler would freeze the entire service for ~450ms
per login.

**Alternatives rejected.** Java/Spring Boot is arguably the better fit for this
domain — real threads, mature transaction management, and it is what airlines
actually run. Rejected on time: a four-day build in an unfamiliar language
produces something that cannot be defended. Go was rejected for the same reason
despite excellent concurrency primitives.

**Why Express over Fastify or NestJS.** Fastify is measurably faster; NestJS gives
structure and dependency injection. Express was chosen because it does the least —
there is no framework magic between the HTTP request and the code, so every line
in a route handler can be explained. For a project whose purpose is
explainability, an opinionated framework hides exactly what needs to be shown.

**What it cost.** No compile-time type checking, so mistakes that TypeScript would
catch appear at runtime. Single-threaded per process means scaling is by running
more processes (Node's cluster module, or more containers), not more threads.

---

## 010 — Sequelize as an ORM, deliberately bypassed on the critical path

**What.** Sequelize handles models, associations, connection pooling and
migrations. But the booking transaction — the row locks, `SKIP LOCKED`, and the
version compare-and-swap — is written as **raw SQL** through
`sequelize.query()`.

**Why use an ORM at all.** Connection pooling, parameterised queries by default
(so string-concatenated SQL injection cannot happen by accident), migrations, and
the association machinery that turns a join into `include`. For the 90% of a
codebase that is ordinary reads and writes, that is real leverage.

**Why bypass it for the important 10%.** ORMs abstract away control over the exact
SQL emitted, and the entire correctness of this system lives in that exact SQL.
`SELECT ... FOR UPDATE SKIP LOCKED` with a specific lock ordering is not something
to express through a query builder and hope it generates what was intended.
Sequelize does have `lock` and `skipLocked` options, but reading the query in the
source — as literal SQL — is what makes the concurrency argument reviewable.

**The general principle:** use the abstraction where it saves work, drop below it
where the details are the point. An ORM used dogmatically leads to writing the
transaction in a way that fits the tool rather than the problem.

**Alternatives rejected.** The raw `pg` driver — complete control, but hand-rolled
pooling, hand-rolled migrations, and manual mapping for every query, which is a
lot of low-value code in four days. Prisma — better developer experience and type
safety, rejected because its escape hatch to raw SQL is less natural and the
resume claim specifically names Sequelize. Knex (query builder, no ORM) is the
closest thing to a middle ground and would also have been defensible.

**What it cost.** ORMs make N+1 query patterns easy to write without noticing —
`include` was used carefully for exactly that reason. The models and the
migrations both describe the schema, so they can silently drift apart. And there
is now a mixed idiom in the codebase: Sequelize methods in most places, raw SQL in
the booking path. That inconsistency is deliberate but it is still inconsistency.

---

## 011 — Schema owned by migrations, not by `sync()`

**What.** Every table is created by a numbered migration file in
`services/*/migrations/`. `sequelize.sync()` is never called.

**Why.** A migration is a versioned, reviewable, ordered change to the schema that
lives in git next to the code that depends on it. Checking out an old commit gives
back the schema that commit expected. `sync({ alter: true })` inspects the models
and mutates the database to match — which sounds convenient until it decides a
renamed column is a drop plus an add, and the data in it is gone. It is a
development toy, not a deployment mechanism.

The tables in this project were first written as hand-typed SQL to learn what the
statements actually do, then **dropped and rebuilt through migrations** so the
repository is the single source of truth. The original SQL survives as reference
dumps in `db/schema/`, regenerated with `pg_dump --schema-only`.

**Alternatives rejected.** `sync()` — see above. Plain `.sql` files run by hand —
no record of what has already been applied, so ordering becomes tribal knowledge
and a re-run is a coin flip.

**What it cost.** Every schema change is two edits — the migration and the model —
and nothing enforces that they agree. Migrations are also append-only in practice:
fixing a mistake means writing another migration, so the history accumulates
corrections rather than staying tidy.

---

## 012 — bcrypt at cost factor 12

**What.** Passwords are hashed with bcrypt, work factor 12. The plaintext is never
stored, logged, or returned.

**Why a *slow* hash.** For passwords, speed is the enemy. If the database leaks,
the attacker's cost is (hash time) x (guesses). A fast hash like SHA-256 lets
commodity GPUs try billions of candidates per second; bcrypt at cost 12 reduces
that to a few thousand. bcrypt also generates a random **salt per password** and
stores it inside the hash string, so two users with the same password get
different hashes and precomputed rainbow tables are useless.

**Why 12 specifically — measured on this machine:**

```
cost 10:  112 ms per hash
cost 12:  450 ms per hash
cost 14: 1365 ms per hash
```

The factor is exponential: each +1 doubles the work. 12 was chosen as the point
where an attacker's offline guessing rate is badly damaged while a legitimate
login stays under half a second.

**Honest caveat:** 450ms is on the slow side for login UX, and it is CPU time that
Node must run on its thread pool. A production system serving real traffic would
likely sit at 10-11 and revisit as hardware improves. The number should be a
measured decision, not a copied constant — which is why it was measured.

**Alternative rejected — and it is arguably better.** **Argon2id** won the Password
Hashing Competition and is the current recommendation of most security guidance.
It is *memory*-hard as well as CPU-hard, which specifically defeats the GPU and
ASIC attacks bcrypt is weakest against. bcrypt was chosen for ubiquity and
familiarity, not because it is superior. If asked "what would you change", this is
a real answer.

Also rejected: SHA-256/MD5 (fast by design, therefore wrong), and storing
plaintext (indefensible).

**What it cost.** bcrypt silently truncates input beyond 72 bytes, so very long
passphrases lose their tail — not exploited here, but worth knowing. And each
login costs real CPU, so login throughput is bounded in a way that a token check
is not.

---

## 013 — JWT for authentication, and the things it genuinely cannot do

**What.** On login, the auth service signs a JSON Web Token containing the user id
and email. Other services verify the signature **locally**, with no call back to
auth and no read access to `auth_db`.

**Why.** This is what makes the service boundary real. The booking service
authenticates a request using only CPU and a shared secret — it does not query the
auth database (it has no permission to) and does not make a network call to the
auth service (which would make auth a synchronous dependency of every request in
the system, and its outage everyone's outage).

**What JWTs cannot do, stated plainly, because these are the questions:**

1. **They cannot be revoked.** A signed token is valid until it expires, full
   stop. If one leaks, there is no way to invalidate it — the verifier consults
   nothing but the signature. Logout deletes the token client-side; it does not
   make the token stop working. The mitigation here is a short expiry
   (`JWT_EXPIRES_IN=1h`), which bounds the damage window rather than closing it.
   A proper system pairs short access tokens with refresh tokens and a revocation
   list. **Not implemented — this is a real gap, not an oversight being hidden.**

2. **The shared secret means every service can mint tokens, not just verify
   them.** HS256 is symmetric: the same key signs and verifies. So the flights
   service, which only needs to *check* tokens, holds a key that can *forge* them.
   A compromise of any service becomes a compromise of authentication everywhere.
   The correct fix is asymmetric signing (RS256/ES256): auth holds the private
   key, everyone else verifies with the public key and can forge nothing. **Also
   not implemented**, and it is the first thing to change if this were real.

3. **Token contents are readable by anyone.** A JWT is signed, not encrypted —
   base64, not ciphertext. The signature stops tampering, not reading. So nothing
   secret goes in the payload; here it is only the user id and email.

**Alternative rejected.** Server-side sessions with a session id in a cookie.
Revocation becomes trivial — delete the row — which is a genuine advantage. But
every service then needs to reach a shared session store to validate a request,
which reintroduces exactly the shared-state coupling that separate databases were
chosen to eliminate. The trade is revocability for independence, and for a
microservice architecture independence won.

**What it cost.** Everything in point 1 and 2 above: no revocation, and a
symmetric key with more power than most holders of it need.

---

## 014 — Docker for infrastructure

**What.** Postgres and Kafka run as containers declared in `docker-compose.yml`.
Nothing is installed into the host operating system.

**Why.** Three properties, in order of importance:

1. **Pinned versions.** `postgres:17-alpine`, `apache/kafka:3.9.0`. Not `latest`.
   Two machines running this project run byte-identical database servers, which
   removes an entire category of "works on mine" bug. `latest` silently drifting
   to a new major version is exactly the failure containers exist to prevent.
2. **Reversibility.** `docker compose down -v` erases every trace. No half-removed
   Postgres cluster, no orphaned system services, no config left in `/etc`.
3. **One command.** A new machine goes from empty to a running three-database
   Postgres and a Kafka broker with `docker compose up -d`, because the topology
   is declared in a file rather than described in a README.

**Alternative rejected.** Installing Postgres and Kafka natively via apt. Works,
and is marginally faster at runtime, but the versions are then whatever the distro
ships, uninstalling is messy, and running a second project needing a different
Postgres major version becomes a real problem.

**What it cost.** Another layer to understand, and it has its own traps — the
`KAFKA_ADVERTISED_LISTENERS` configuration in `docker-compose.yml` is commented at
length precisely because getting it wrong produces a broker that accepts the first
connection and fails every one after. Container networking, volume lifetimes, and
"why is my data gone" (`down` versus `down -v`) are all genuinely new concepts,
not free abstraction.

Note the asymmetry, which is deliberate: the **infrastructure** is containerised,
the **Node services** are not — they still run directly on the host with
`./scripts/services.sh`. That is a development convenience (instant restarts, no
image rebuild per edit) and it is unfinished work, not a design decision.
Containerising the services is a remaining task.

---

## 015 — Notifications as a separate service and a second consumer group

**What.** A fourth service (`services/notifications`) with its own database and
its own login role, consuming the **same** `booking-events` topic as the flights
service but in a **different consumer group**.

**Why this is the proof that decision 007 was real.** Adding notifications
required **no change to the booking service**. No new endpoint, no extra publish,
no configuration. A new subscriber appeared on an existing event stream and the
producer never learned about it.

That is precisely the property that chose Kafka over RabbitMQ. In a queue,
consumption is destructive — if the notifications service took a message, the
flights service would never see it. Supporting both would mean the producer
fanning out to two queues, so every new subscriber becomes a change to the
producer, and the producer slowly accumulates knowledge of everyone who depends
on it. With a retained log, each group tracks its own offset and reads
everything, independently and at its own pace.

Verified rather than asserted — both groups on the same topic, separate offsets:

```
flights-read-model   booking-events  p0:2  p1:0  p2:1
notifications        booking-events  p0:2  p1:-  p2:1
```

**Its own database, for the same reason as everyone else's.** `notifications_db`
with `notifications_svc`, `CONNECT` revoked from `PUBLIC`. It also keeps its
**own** dedup state rather than sharing the flights service's `processed_events`
table — the two consume the same events at different times and independently, so
shared dedup state would recreate exactly the coupling separate services exist to
remove.

**Claim before delivering, not after.** The notification row is written as
`pending` and committed *first*; the send happens after. Sending is an external
side effect that cannot be rolled back — once an email leaves, it is gone, and no
database transaction can retract it. Committing the claim first means a crash
mid-send leaves a visible `pending` row rather than either a silent gap or a
second message. The primary key on `event_id` is what makes redelivery a no-op.

Verified: consumer offsets reset to zero, every event redelivered, and the
notification count stayed at 3 with zero extra messages delivered.

**A delivery failure is deliberately not rethrown.** Throwing would stop kafkajs
committing the offset, so the event would redeliver forever — and since the dedup
row now exists, every retry would be swallowed as a duplicate anyway. A single
undeliverable message would halt its entire partition, blocking every later event
behind it. The `failed` row is the record instead. The correct fix is a retry
sweeper over `status = 'pending'`/`'failed'` (the partial index for it exists);
it is not built.

**What is NOT built, stated plainly.** Delivery is **simulated** — notifications
are written to a file and the console, not emailed. Real delivery means SMTP or a
provider, credentials, a verified sending domain and bounce handling. The part
worth defending is the pipeline: that a booking reliably produces exactly one
notification record, survives redelivery, and costs the booking service nothing.
Swapping the delivery function for nodemailer is plumbing that would demonstrate
nothing further. A stub that quietly implied working email would be worse than
saying this.

---

## 016 — PostgreSQL rather than MongoDB

**What.** All four databases are PostgreSQL. No document store anywhere.

**Why.** The requirement that decides it is the one this whole project exists to
satisfy: **one seat, one booking**, enforced under concurrency. Meeting that needs
three things, and Postgres provides all three natively:

1. **Multi-row, multi-table ACID transactions.** A booking atomically flips seat
   rows to `booked`, inserts a `bookings` row, inserts `booking_seats` rows, and
   inserts an `outbox` row. Either all of that happens or none of it does.
   MongoDB has supported multi-document transactions since 4.0, so this is no
   longer a hard "cannot" — but it is bolted onto a model designed around the
   single-document atomicity assumption, carries real performance caveats, and is
   not the path the database is optimised for.
2. **Row-level locking with `SELECT ... FOR UPDATE` and `SKIP LOCKED`.** This is
   the core mechanism of the booking service, and `SKIP LOCKED` in particular —
   the thing that lets 36 concurrent requests each take a *different* seat rather
   than queueing — has no clean MongoDB equivalent. Emulating it means
   `findOneAndUpdate` loops with retry logic, which is more code doing a worse
   job.
3. **Declarative constraints as a correctness backstop.** The partial unique
   index `UNIQUE (flight_seat_id) WHERE cancelled_at IS NULL` is the last line of
   defence against double booking, and it holds even if the application logic
   above it is wrong. MongoDB has unique and partial indexes too, so this one is
   closer than the others — but `CHECK` constraints, foreign keys, and the whole
   habit of pushing invariants into the schema are Postgres's native idiom.

**The deeper reason: the data is relational, and pretending otherwise costs more
than it saves.** Flights reference airports. Bookings reference flights and
users. Seats belong to flights. Booking-seats join bookings to seats. These are
foreign keys with genuine referential integrity requirements — not documents that
happen to sit near each other. Modelling them as embedded documents would mean
either duplicating data (and then reconciling the duplicates) or hand-rolling
joins in application code.

**Where MongoDB would have been the better choice.** This is not a
"NoSQL is bad" position. A document store fits when:

- the shape of the data varies per record (product catalogues, user-defined
  fields, CMS content)
- the natural access pattern is "fetch one whole document by id" and the document
  *is* the transactional boundary
- horizontal write scaling across shards matters more than cross-entity
  consistency

None of those describe seat inventory. If this project had a *notification
templates* service or an *audit log with varying event shapes*, a document store
would be a defensible fit for that piece.

**Alternatives also rejected.** MySQL is a perfectly reasonable answer — it has
InnoDB row locking, transactions, and `SKIP LOCKED` since 8.0. Postgres was
chosen for partial indexes (used as the double-booking backstop), stricter
default behaviour, `JSONB` for the outbox payload, and `READ COMMITTED` as a
default whose semantics are easier to reason about than MySQL's `REPEATABLE
READ` with gap locking. Redis was rejected as a primary store outright:
in-memory, and durability is a tuning decision rather than a guarantee, which is
disqualifying for the record of what someone paid for.

**What it cost.** A rigid schema — every shape change is a migration, which is
friction during rapid iteration. Horizontal write scaling is harder than in a
system designed for sharding from the start. Both are acceptable: this workload
is read-heavy with contended writes on a small hot set, which is the shape
Postgres handles well.

---

## 017 — Cancellation needs no idempotency key, and that is the point

**What.** `POST /bookings/:id/cancel` requires **no** `Idempotency-Key` header,
unlike `POST /bookings`. A repeated cancellation returns `200` with the same body
rather than an error.

**Why the difference.** Creating a booking is **not naturally idempotent**.
"Book me a seat on flight 4" sent twice legitimately means two seats — that is a
real thing a user might want. Nothing in the request distinguishes an accidental
retry from a deliberate second booking, so only a client-supplied key can carry
that intent (DECISIONS.md 005).

Cancellation is the opposite. The end state of "cancel booking 7" is identical
however many times it is applied: the booking is cancelled. The operation is
idempotent **by its own semantics**, so it needs no key to become so — it needs
only to be *implemented* so that repeats are harmless.

The general rule worth carrying: **do not reach for an idempotency key before
asking whether the operation is already idempotent.** `PUT` and `DELETE` usually
are; `POST`-as-create usually is not. A key added to an operation that does not
need one is machinery that must be maintained, expired and reasoned about for no
benefit.

**How repeats are made harmless.** The transaction takes `SELECT ... FOR UPDATE`
on the booking row first. A second concurrent cancellation blocks there, and by
the time it proceeds the first has committed `status = 'cancelled'`, so it
returns the same answer with `seats_released: 0` instead of releasing the seats
again.

Measured — 10 concurrent cancellations of the same booking:

```
10 x HTTP 200
 1  response with seats_released > 0
 read model returned to 36, not over-released
```

**Why POST and not DELETE.** Nothing is deleted. The booking moves to
`cancelled` and its seat assignments are stamped with `cancelled_at`. `DELETE`
would imply the record disappears, which would destroy the audit trail of who
held a seat and when.

**This is what the partial index was for.** Setting `cancelled_at` removes the
row from `UNIQUE (flight_seat_id) WHERE cancelled_at IS NULL`, so the seat
becomes bookable again while the historical row survives. Verified: seat 5A was
booked, cancelled, then rebooked, leaving two rows for the same seat — one
cancelled, one active — with exactly one active. A plain unique index would have
made the seat permanently unbookable after its first cancellation; deleting the
row instead would have freed the seat and lost the history. The partial index is
what allows both.

**Lock ordering.** Cancellation locks the booking row, then its seats `ORDER BY
fs.id`. Booking creation locks seat rows and then *inserts* a new booking row —
it never waits on an existing booking row — so the two paths cannot form a
deadlock cycle.

**Authorization returns 404, not 403.** A user cancelling someone else's booking
gets `booking not found`. `403` would confirm that the id exists, which is an
information leak that lets an attacker enumerate valid booking ids.

**What it cost.** No refund processing — `refund_amount_cents` is reported in the
event payload but no payment system is integrated, and there is no cancellation
window or fee policy. Both are product decisions rather than technical ones, and
neither would demonstrate anything the seat-release path does not already show.

---

## 018 — Containerised services behind Nginx as the single entry point

**What.** All four Node services run as containers. Nginx fronts them and is the
**only** thing published to the host (port 8080). The services declare no host
port mapping at all.

**Why a gateway.** Without one, a client must know that auth is on 4001, flights
on 4002 and bookings on 4003 — the internal topology leaks into every caller, and
splitting or merging a service becomes a breaking change for them. With a gateway
there is one address and routing is a server-side concern.

It is also the natural single home for what would otherwise be reimplemented four
times: TLS termination, rate limiting, request logging, CORS, and refusing to
route anything that should never be public.

**Not publishing service ports is the whole point.** Verified: `localhost:4001`,
`:4002` and `:4003` are unreachable from the host, while `bookings` still reaches
`http://flights:4002` by name on the internal network. A gateway that can be
bypassed is a convenience, not a boundary.

The racy demo endpoint is blocked twice over — `ENABLE_UNSAFE_DEMO=false` in the
container *and* `location /demo/ { return 404; }` in nginx. Two independent
controls, because one misconfiguration should not expose it.

**Multi-stage builds, and migrations as a separate job.** Each Dockerfile has a
`migrator` stage (keeps devDependencies, since sequelize-cli lives there) and a
`runtime` stage (`npm ci --omit=dev`). Migrations run as one-shot containers that
apply pending changes and exit; the app services wait on
`condition: service_completed_successfully`.

Migrations deliberately do **not** run at application startup. With more than one
replica, several containers would race to apply the same migration on boot — and
a schema change should be a deliberate reviewable operation, not a side effect of
a process restarting.

**`proxy_next_upstream off`.** Nginx will not silently retry a failed request on
another backend. Retrying a `POST` that may already have been processed is how one
booking becomes two. The idempotency key exists so that retrying is a *client*
decision made deliberately, not something the proxy does invisibly.

**Rate limiting is deliberately absent.** A gateway is the right place for it, and
production would have it. It is off here because the load tests drive high request
rates through this proxy, and a limiter would either corrupt those numbers or have
to be tuned so high it never fires — which is theatre. Claiming a rate limit set
never to trigger is worse than having none.

**Two bugs this surfaced, both worth knowing.**

1. **A named volume mounted at the wrong path is silently useless.** The Kafka
   volume was mounted at `/var/lib/kafka/data`, but the image defaults to writing
   in `/tmp/kafka-logs`. Docker created the volume, mounted it, reported the
   container healthy — and Kafka never wrote a byte to it, so every topic was
   destroyed the moment the container was recreated. Fixed by setting
   `KAFKA_LOG_DIRS` explicitly to match the mount. The failure mode is nasty
   precisely because nothing errors.
2. **A healthcheck using `localhost` can report a healthy service as down.**
   Inside the container `localhost` resolved to `::1` first, and nginx listens
   only on IPv4, so the check failed while the gateway served real traffic
   normally. Fixed by using `127.0.0.1`.

**The correctness proof was re-run through the proxy**, not around it — 30
concurrent requests for one seat still produced exactly one winner, and 40
requests against 36 free seats still produced 36 distinct seats. Worth doing:
a concurrency guarantee demonstrated only against a direct connection has not
been demonstrated in the shape that actually ships.

**What it cost, stated plainly.**

- **One replica of everything.** No horizontal scaling is demonstrated, so the
  `upstream` blocks are load balancers with a single member. Adding replicas is a
  config change, but "it would work" is not the same as "it was measured".
- **No TLS.** Plain HTTP on 8080. Real deployment terminates TLS at this layer;
  certificates were out of scope.
- **Secrets are in the compose file.** Local-development credentials committed on
  purpose so the stack starts with one command. A real deployment injects them at
  runtime and never commits them.
- **Postgres and Kafka still publish host ports**, purely so `psql`, the load
  tests and the host-mode dev workflow keep working. Production would not.
- **Node runs as PID 1 in these containers.** It works here because the services
  register explicit `SIGTERM`/`SIGINT` handlers, but PID 1 gets no default signal
  handling — without those handlers, `docker stop` would hang until the timeout
  and then kill the process, dropping in-flight requests.

---

## 019 — k6 load testing, and the bug it found

**What.** Two k6 scenarios run against the containerised stack **through the
Nginx gateway**: `k6/search-load.js` (read path) and `k6/booking-load.js`
(contended write path). k6 runs as a container joined to the project's Docker
network, so nothing is installed on the host and traffic goes through the gateway
rather than around it.

**Measured — 50 VUs read, 30 VUs write, on one laptop:**

```
SEARCH  (GET /flights)      54,570 reqs @ 1212/s   0.000% failed
        med 25.2ms   p90 41.2ms   p95 44.2ms   p99 56.6ms   max 113.9ms

BOOKING (POST /bookings)    10,331 reqs @ 215/s    0.000% failed
        med 79.6ms   p90 117.7ms  p95 129.3ms  p99 176.0ms  max 306.2ms
        5,000 created · 5,329 conflicts (51.6%)
```

**The correctness invariant held under sustained load**, which is the number that
actually matters:

```
5,000 seats · 5,000 booked · 5,000 distinct active assignments · 0 sold twice
```

10,331 concurrent booking attempts against 5,000 seats produced exactly 5,000
bookings. Every rejection was a legitimate 409 after the flight sold out. The
event pipeline kept pace too: 5,046 outbox rows published with none pending,
5,046 events consumed by the flights read model, 5,046 notifications — all three
counts equal.

**409 is not a failure, and saying so is the whole test design.** k6 counts any
non-2xx as failed by default. Under contention, "seat already taken" is the
system *working* — a naive version of this test would have reported a ~50%
failure rate against a perfectly behaving system, and every threshold would have
been meaningless. `http.setResponseCallback(http.expectedStatuses(200, 201, 409))`
declares 409 expected, and conflicts are tracked as their own metric instead.

**Thresholds, not vanity numbers.** Each scenario declares pass/fail assertions
(`p(95)<200`, `p(99)<500` for reads; `p(95)<800`, `p(99)<1500` for writes,
`http_req_failed: rate<0.01`). k6 exits non-zero when one is crossed, so these
runs are regression tests, not decoration. A latency number with no threshold
attached is trivia.

### The bug this found — the actual justification for load testing

The first search run reported **11.22% of 31,802 requests failing with 502**,
while the flights service logged **no errors, never restarted, and stayed
healthy**. The fault was in the gateway configuration, not the application.

`proxy_common.conf` sets `proxy_http_version 1.1` and clears the `Connection`
header, which tells the upstream "hold this connection open for reuse". But the
`upstream` blocks had no `keepalive` directive, so nginx maintained no connection
cache — it opened a fresh connection per request and abandoned it while the
backend held it open expecting reuse. Under load those close/reuse races surface
as intermittent 502s. **The two settings must agree: either both keep-alive, or
neither.**

Adding `keepalive 32` per upstream:

```
                  before        after
502 failures      11.22%        0.000%
throughput        669/s         1160/s      (+73%)
p95               84.6ms        42.9ms      (-49%)
max               294ms         65ms
```

This is the case for load testing stated plainly: functional tests all passed,
the concurrency proof passed, every container reported healthy, and the system
was still failing one request in nine under realistic load. Nothing but load
found it.

**What these numbers are NOT.** k6, four Node services, Postgres and Kafka all
share one laptop's CPU — the load generator competes with the system it is
measuring, so throughput is conservative and latency pessimistic. There is one
replica of each service, no network latency between components, and a small
dataset that fits in cache. These are useful as a **baseline and a regression
guard on this hardware**, not as capacity figures for a real deployment. Quoting
them as "the system does 1200 req/s" without that context would be dishonest.

**Load-test fixture.** `scripts/loadtest-seed.sh` creates flight 999 with 5,000
seats, because the demo flights hold 216 seats in total and would sell out in
seconds — after which the test would be measuring the sold-out rejection path
rather than the booking path. It sets `aircraft_capacity` in `flights_db` and the
`flight_seats` rows in `bookings_db` together, since no foreign key can keep them
consistent across databases.

---
