const crypto = require('crypto');
const { UniqueConstraintError } = require('sequelize');
const { IdempotencyKey } = require('../../models');

// A retry must carry the same payload as the original request. Hashing the
// canonical form of the body lets us detect a client reusing one key for two
// genuinely different requests — that is a bug on their side, and replaying the
// first response would hide it.
function fingerprint(body) {
  const canonical = JSON.stringify(body, Object.keys(body).sort());
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/**
 * Claim an idempotency key for this request.
 *
 * The claim is its own transaction and commits IMMEDIATELY, before any booking
 * work starts. That ordering is deliberate: a concurrent retry arriving while
 * the first request is still working must be able to SEE the in-progress row.
 * If the claim were part of the booking transaction it would stay invisible
 * until commit, and both requests would attempt the booking.
 *
 * Two concurrent retries therefore race on the primary key. Exactly one INSERT
 * wins; the loser gets a unique-violation and reads the winner's row.
 *
 * Returns either { claimed: true } or { claimed: false, replay: {...} }.
 */
async function claim({ key, userId, body }) {
  const requestFingerprint = fingerprint(body);

  try {
    await IdempotencyKey.create({
      key,
      user_id: userId,
      request_fingerprint: requestFingerprint,
      status: 'in_progress',
    });
    return { claimed: true, requestFingerprint };
  } catch (err) {
    if (!(err instanceof UniqueConstraintError)) throw err;
  }

  const existing = await IdempotencyKey.findByPk(key);
  if (!existing) {
    // The row vanished between the failed insert and this read — only possible
    // if something deleted it concurrently. Treat as retryable.
    return { claimed: false, replay: { status: 409, body: { error: 'retry the request' } } };
  }

  // Keys are scoped per user: a key belonging to someone else must never
  // surface their booking. Reported as a plain conflict, revealing nothing.
  if (String(existing.user_id) !== String(userId)) {
    return { claimed: false, replay: { status: 409, body: { error: 'idempotency key already used' } } };
  }

  if (existing.request_fingerprint !== requestFingerprint) {
    return {
      claimed: false,
      replay: {
        status: 422,
        body: { error: 'idempotency key reused with a different request body' },
      },
    };
  }

  if (existing.status === 'in_progress') {
    // The original request is still running. The client should retry shortly;
    // returning its eventual answer would mean blocking here holding a
    // connection open.
    return {
      claimed: false,
      replay: { status: 409, body: { error: 'a request with this idempotency key is in progress' } },
    };
  }

  // Completed or failed: replay the stored answer verbatim. This is what makes
  // the endpoint idempotent — a retried booking returns the FIRST booking, and
  // never creates a second one.
  return {
    claimed: false,
    replay: { status: existing.response_status, body: existing.response_body, replayed: true },
  };
}

async function complete({ key, status, responseStatus, responseBody, bookingId }) {
  await IdempotencyKey.update(
    {
      status,
      response_status: responseStatus,
      response_body: responseBody,
      booking_id: bookingId ?? null,
    },
    { where: { key } }
  );
}

module.exports = { claim, complete, fingerprint };
