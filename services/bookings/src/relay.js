require('dotenv').config();
const { Kafka, Partitioners } = require('kafkajs');
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models');

// =============================================================================
// OUTBOX RELAY
//
// Reads rows the booking transaction committed into `outbox` and publishes them
// to Kafka. This is the process that turns a database row into an event.
//
// WHY THIS EXISTS AT ALL: a booking must both commit to Postgres and announce
// itself to Kafka, atomically. Those are two different systems, so there is no
// shared transaction. Publishing inside the booking transaction risks
// announcing a booking that then rolls back; publishing after commit risks the
// process dying before it publishes, losing the event silently. The outbox
// removes the dilemma — the event is written as a row, inside the same
// transaction, and this relay delivers it afterwards.
//
// DELIVERY SEMANTICS: at-least-once. The order below is deliberate —
//
//     1. claim the row      2. publish to Kafka      3. mark published
//
// A crash between 2 and 3 means the row is still unpublished, so it gets
// published AGAIN on the next pass. That is a duplicate, not a loss.
// Reversing 2 and 3 would trade duplicates for silent data loss, which is a far
// worse failure: a duplicate can be absorbed by an idempotent consumer, a lost
// event cannot be recovered by anyone.
//
// Therefore EVERY consumer of these events must be idempotent. The flights
// service consumer uses an inbox table to enforce that.
// =============================================================================

const TOPIC = process.env.KAFKA_TOPIC || 'booking-events';
const POLL_INTERVAL_MS = Number(process.env.RELAY_POLL_INTERVAL_MS || 1000);
const BATCH_SIZE = Number(process.env.RELAY_BATCH_SIZE || 100);

const kafka = new Kafka({
  clientId: 'bookings-outbox-relay',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
  retry: { initialRetryTime: 300, retries: 8 },
});

const producer = kafka.producer({
  // The idempotent producer tags each message with a sequence number so the
  // broker can discard duplicates caused by the producer's OWN retries (send
  // succeeded, ack lost, client retries). It does not deduplicate across relay
  // restarts — that is what the consumer-side inbox is for.
  idempotent: true,
  createPartitioner: Partitioners.DefaultPartitioner,
});

let running = true;

/**
 * Claim a batch of unpublished events.
 *
 * FOR UPDATE SKIP LOCKED again, and for the same reason as seat allocation:
 * if two relay instances run, each should take rows the other is not holding
 * rather than queue behind it. This is what makes the relay horizontally
 * scalable instead of a singleton that must never be run twice.
 *
 * ORDER BY id keeps publication in the order events were created.
 */
async function claimBatch(transaction) {
  return sequelize.query(
    `SELECT id, aggregate_type, aggregate_id, event_type, payload, created_at
       FROM outbox
      WHERE published_at IS NULL
      ORDER BY id
      LIMIT :batchSize
      FOR UPDATE SKIP LOCKED`,
    {
      replacements: { batchSize: BATCH_SIZE },
      type: QueryTypes.SELECT,
      transaction,
    }
  );
}

async function publishBatch() {
  // The Kafka publish happens INSIDE this transaction, which normally would be
  // the mistake called out in DECISIONS.md 006 — never hold a transaction open
  // across a network call. The distinction is what the lock costs: there it was
  // seat rows on the request path, where a stall blocks paying customers. Here
  // it is outbox rows in a background worker, contended only by other relay
  // instances, and the lock is precisely what stops two relays double-
  // publishing. The trade is deliberate, not accidental.
  return sequelize.transaction(async (transaction) => {
    const events = await claimBatch(transaction);
    if (events.length === 0) return 0;

    await producer.send({
      topic: TOPIC,
      // acks: -1 means every in-sync replica must acknowledge before this
      // resolves. With one broker that is just the leader, but the setting is
      // what makes adding brokers later a config change rather than a rewrite.
      acks: -1,
      messages: events.map((event) => ({
        // THE KEY DETERMINES THE PARTITION, and Kafka orders messages only
        // within a partition. Keying by flight_id means every event for one
        // flight is consumed in the order it was produced — which matters,
        // because a "seat booked" followed by "booking cancelled" applied out
        // of order leaves the read model permanently wrong.
        key: String(event.payload.flight_id ?? event.aggregate_id),
        value: JSON.stringify({
          event_id: String(event.id),
          event_type: event.event_type,
          aggregate_type: event.aggregate_type,
          aggregate_id: String(event.aggregate_id),
          occurred_at: event.created_at,
          payload: event.payload,
        }),
        headers: {
          // The outbox row id is the deduplication key consumers use. It is
          // stable across republication, which is exactly what makes
          // at-least-once delivery survivable.
          'event-id': String(event.id),
          'event-type': event.event_type,
        },
      })),
    });

    await sequelize.query(
      `UPDATE outbox SET published_at = now() WHERE id IN (:ids)`,
      { replacements: { ids: events.map((e) => e.id) }, transaction }
    );

    return events.length;
  });
}

async function main() {
  await producer.connect();
  console.log(`outbox relay started — topic "${TOPIC}", polling every ${POLL_INTERVAL_MS}ms`);

  while (running) {
    try {
      const published = await publishBatch();
      if (published > 0) console.log(`published ${published} event(s)`);
      // Only sleep when there was nothing to do. A full batch probably means
      // more is waiting, so loop straight round rather than idling.
      if (published < BATCH_SIZE) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    } catch (err) {
      // A failure here is safe: the transaction rolled back, so the rows stay
      // unpublished and will be retried. Back off so a broker outage does not
      // become a hot loop.
      console.error('relay batch failed, will retry:', err.message);
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS * 5));
    }
  }
}

// Finish cleanly rather than dying mid-batch. An in-flight transaction would
// roll back anyway and the events would be republished, but a clean exit avoids
// producing duplicates unnecessarily.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    console.log(`\n${signal} received, shutting down relay`);
    running = false;
    await producer.disconnect().catch(() => {});
    await sequelize.close().catch(() => {});
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('relay failed to start:', err);
  process.exit(1);
});