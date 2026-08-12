const fs = require('fs/promises');
const path = require('path');

// =============================================================================
// DELIVERY — SIMULATED, and labelled as such rather than dressed up.
//
// This writes each notification to a file and the console. It does not send
// email. Real delivery means an SMTP server or a provider like SES/SendGrid:
// credentials, a verified sending domain, bounce handling, and an external
// dependency that fails in its own ways.
//
// That was left out on purpose. The part of this system worth building and
// defending is the EVENT PIPELINE — that a booking reliably, exactly-once
// produces a notification record, survives redelivery, and does not depend on
// the booking service knowing this consumer exists. Swapping this function for
// nodemailer is an afternoon of plumbing that would demonstrate nothing new.
//
// Stating that plainly is better than a stub that quietly implies email works.
// =============================================================================

const OUTPUT_FILE = process.env.NOTIFICATION_OUTPUT
  || path.join(__dirname, '../../../.logs/notifications-sent.log');

async function deliver(notification) {
  const rendered = [
    '─'.repeat(60),
    `To:      user ${notification.user_id}`,
    `Channel: ${notification.channel}`,
    `Subject: ${notification.subject}`,
    '',
    notification.body,
    `(event ${notification.event_id}, booking ${notification.booking_id})`,
    '',
  ].join('\n');

  await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
  await fs.appendFile(OUTPUT_FILE, rendered);

  console.log(`  → notification delivered to user ${notification.user_id}: "${notification.subject}"`);
}

module.exports = { deliver, OUTPUT_FILE };
