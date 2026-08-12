require('dotenv').config();
const { Kafka } = require('kafkajs');
const { UniqueConstraintError } = require('sequelize');
const { Flight, ProcessedEvent, sequelize } = require('../models');

// =============================================================================
// BOOKING EVENT CONSUMER
//
// Keeps `flights.seats_available` in step with the booking service's authoritative
// seat inventory, which lives in another database this service cannot read.
//
// This is the "eventual consistency" in the system, and it is confined to a
// place where staleness is harmless: search results. A search may briefly show
// 3 seats when 1 remains. At the moment it actually matters — booking time —
// the booking service reads its own data transactionally and the correct answer
// wins. Stale reads are acceptable; stale writes are not.
//
// WHAT HAPPENS IF THIS CONSUMER FAILS:
//   - It stops committing offsets, so on restart it resumes from the last
//     committed offset and reprocesses anything in between. Nothing is lost;
//     Kafka retains the log independently of who has read it.
//   - Bookings keep working the entire time. The booking service does not
//     depend on this consumer — only the search read model goes stale, and it
//     catches up once the consumer returns. That is the point of decoupling
//     through a log rather than a synchronous call.
//   - Reprocessing is safe because every effect is guarded by the inbox table.
// =============================================================================

const TOPIC = process.env.KAFKA_TOPIC || 'booking-events';
const GROUP_ID = process.env.KAFKA_CONSUMER_GROUP || 'flights-read-model';

const kafka = new Kafka({
  clientId: 'flights-consumer',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
  retry: { initialRetryTime: 300, retries: 8 },
});

// The CONSUMER GROUP is what makes this horizontally scalable: Kafka assigns
// each partition to exactly one member of a group, so running three instances
// spreads the three partitions across them with no duplicated work. A second,
// differently-named group (say a notifications service) reads the same events
// independently, with its own offsets — which is the property that made Kafka
// the right choice here over a queue that deletes on acknowledgement.
const consumer = kafka.consumer({ groupId: GROUP_ID });

const HANDLERS = {
  'booking.confirmed': async (event, transaction) => {
    const seats = Number(event.payload.seats_booked ?? 0);
    if (seats <= 0) return;

    // Guarded by `seats_available >= seats` so the column can never go
    // negative, even if events arrive that this read model cannot reconcile.
    // The CHECK constraint on the table would reject it anyway; this makes the
    // outcome a no-op rather than a crash loop.
    await sequelize.query(
      `UPDATE flights
          SET seats_available = seats_available - :seats
        WHERE id = :flightId
          AND seats_available >= :seats`,
      {
        replacements: { seats, flightId: event.payload.flight_id },
        transaction,
      }
    );
  },

  'booking.cancelled': async (event, transaction) => {
    const seats = Number(event.payload.seats_released ?? 0);
    if (seats <= 0) return;

    await sequelize.query(
      `UPDATE flights
          SET seats_available = seats_available + :seats
        WHERE id = :flightId
          AND seats_available + :seats <= aircraft_capacity`,
      {
        replacements: { seats, flightId: event.payload.flight_id },
        transaction,
      }
    );
  },
};

async function handleEvent(event) {
  const handler = HANDLERS[event.event_type];
  if (!handler) {
    // Unknown event types are skipped, not treated as errors. Other services
    // will publish to this topic over time and a consumer must tolerate events
    // it does not care about, or every new event type becomes a breaking change.
    return { status: 'ignored' };
  }

  try {
    await sequelize.transaction(async (transaction) => {
      // Claim the event first. If it was already processed, the primary key
      // rejects this INSERT and the whole transaction — including the seat
      // adjustment below — rolls back. Effect and record are atomic.
      await ProcessedEvent.create(
        { event_id: event.event_id, event_type: event.event_type },
        { transaction }
      );

      await handler(event, transaction);
    });
    return { status: 'applied' };
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      // A redelivery. Expected under at-least-once, and correctly a no-op.
      return { status: 'duplicate' };
    }
    throw err;
  }
}

async function main() {
  await sequelize.authenticate();
  await consumer.connect();
  await consumer.subscribe({ topic: TOPIC, fromBeginning: true });

  console.log(`consumer started — topic "${TOPIC}", group "${GROUP_ID}"`);

  await consumer.run({
    // Offsets are committed by kafkajs AFTER eachMessage resolves. So a crash
    // mid-handler means the message is redelivered — at-least-once, end to end,
    // and the reason the inbox table exists.
    eachMessage: async ({ message, partition }) => {
      const event = JSON.parse(message.value.toString());
      const result = await handleEvent(event);
      console.log(
        `[p${partition}] ${event.event_type} event=${event.event_id} → ${result.status}`
      );
    },
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    console.log(`\n${signal} received, shutting down consumer`);
    // Leaving the group explicitly triggers an immediate rebalance instead of
    // waiting for the session timeout to expire.
    await consumer.disconnect().catch(() => {});
    await sequelize.close().catch(() => {});
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('consumer failed to start:', err);
  process.exit(1);
});