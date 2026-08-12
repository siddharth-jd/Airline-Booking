require('dotenv').config();
const { Kafka } = require('kafkajs');
const { UniqueConstraintError } = require('sequelize');
const { Notification, sequelize } = require('../models');
const { deliver } = require('./deliver');

// =============================================================================
// NOTIFICATION CONSUMER
//
// Reads the SAME `booking-events` topic as the flights service, in a DIFFERENT
// consumer group. That single fact is the practical demonstration of why Kafka
// was chosen over a queue (DECISIONS.md 007):
//
//   - Kafka retains the log. Each consumer group tracks its own offset, so both
//     groups read every event independently. Neither knows the other exists.
//   - The booking service was NOT modified to add this feature. No new endpoint,
//     no extra publish, no config change. A new subscriber to an existing event
//     stream costs the producer nothing.
//   - With a queue, where consumption is destructive, one consumer taking a
//     message means the other never sees it. Supporting both would require the
//     producer to fan out to two queues — so every new subscriber becomes a
//     change to the producer.
//
// FAILURE BEHAVIOUR: if this service is down, bookings still succeed and the
// flights read model still updates. Only notifications are delayed, and Kafka
// retains the events, so on restart it resumes from its own committed offset
// and sends what it missed. It is a genuinely independent failure domain.
// =============================================================================

const TOPIC = process.env.KAFKA_TOPIC || 'booking-events';
const GROUP_ID = process.env.KAFKA_CONSUMER_GROUP || 'notifications';

const kafka = new Kafka({
  clientId: 'notifications-consumer',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
  retry: { initialRetryTime: 300, retries: 8 },
});

const consumer = kafka.consumer({ groupId: GROUP_ID });

function composeMessage(event) {
  const { payload } = event;
  const seats = Array.isArray(payload.seats) ? payload.seats.join(', ') : '';
  const amount = (Number(payload.total_price_cents || 0) / 100).toFixed(2);

  if (event.event_type === 'booking.confirmed') {
    return {
      subject: `Booking confirmed — ${seats || payload.seats_booked + ' seat(s)'}`,
      body: [
        `Your booking #${payload.booking_id} is confirmed.`,
        `Flight: ${payload.flight_id}`,
        seats ? `Seats: ${seats}` : `Seats booked: ${payload.seats_booked}`,
        `Total paid: ${amount}`,
      ].join('\n'),
    };
  }

  return {
    subject: `Booking #${payload.booking_id} cancelled`,
    body: `Your booking #${payload.booking_id} has been cancelled and the seats released.`,
  };
}

const NOTIFIABLE = new Set(['booking.confirmed', 'booking.cancelled']);

async function handleEvent(event) {
  if (!NOTIFIABLE.has(event.event_type)) return { status: 'ignored' };

  const { subject, body } = composeMessage(event);

  // Claim the event by writing the notification row as 'pending'. The primary
  // key on event_id makes this the deduplication point: a redelivered event
  // fails here and no second message is composed or sent.
  let notification;
  try {
    notification = await Notification.create({
      event_id: event.event_id,
      user_id: event.payload.user_id,
      booking_id: event.payload.booking_id,
      channel: 'email',
      subject,
      body,
      status: 'pending',
    });
  } catch (err) {
    if (err instanceof UniqueConstraintError) return { status: 'duplicate' };
    throw err;
  }

  // Delivery happens AFTER the claim is committed, deliberately. Sending is an
  // external side effect that cannot be rolled back — once an email is out, it
  // is out. Committing the claim first means a crash mid-send leaves a visible
  // 'pending' row rather than either a lost notification or a second one.
  try {
    await deliver(notification);
    await notification.update({ status: 'sent', sent_at: new Date() });
    return { status: 'sent' };
  } catch (err) {
    await notification.update({ status: 'failed' }).catch(() => {});
    // Deliberately NOT rethrown. Throwing would stop the consumer committing
    // its offset, so this event would be redelivered forever — and the dedup
    // row now exists, so every retry would be swallowed as a duplicate anyway.
    // A stuck poison message would halt the whole partition. The failed row is
    // the record; a retry sweeper is the correct fix and is not built.
    console.error(`delivery failed for event ${event.event_id}:`, err.message);
    return { status: 'failed' };
  }
}

async function main() {
  await sequelize.authenticate();
  await consumer.connect();
  await consumer.subscribe({ topic: TOPIC, fromBeginning: true });

  console.log(`notifications consumer started — topic "${TOPIC}", group "${GROUP_ID}"`);

  await consumer.run({
    eachMessage: async ({ message, partition }) => {
      const event = JSON.parse(message.value.toString());
      const result = await handleEvent(event);
      console.log(`[p${partition}] ${event.event_type} event=${event.event_id} → ${result.status}`);
    },
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    console.log(`\n${signal} received, shutting down notifications consumer`);
    await consumer.disconnect().catch(() => {});
    await sequelize.close().catch(() => {});
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('notifications consumer failed to start:', err);
  process.exit(1);
});
