const { QueryTypes } = require('sequelize');
const db = require('../../models');
const { Booking, BookingSeat, OutboxEvent, sequelize } = db;

// Domain errors. These carry an HTTP status so the route layer stays thin and
// the business rules stay here.
class BookingError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Lock the requested seats.
 *
 * TWO LOCK MODES, and the difference matters:
 *
 *   FOR UPDATE             — used when the client asked for SPECIFIC seats
 *                            ("14A and 14B"). We need exactly those rows, so if
 *                            another transaction holds one we must WAIT for it
 *                            and then re-check: no substitute will do.
 *
 *   FOR UPDATE SKIP LOCKED — used when the client asked for ANY n seats. Here a
 *                            locked row is useless to us, and waiting for it
 *                            would be pointless because there are other free
 *                            seats. SKIP LOCKED steps over rows another
 *                            transaction holds and takes the next free ones.
 *                            This is what stops a queue forming under load:
 *                            100 concurrent "book any seat" requests grab 100
 *                            different rows instead of all serialising on one.
 *
 * ORDER BY id in the specific-seat query is not cosmetic. Two transactions
 * requesting overlapping seat sets in opposite orders can deadlock (A locks 1
 * waits for 2; B locks 2 waits for 1). A consistent lock ordering makes that
 * impossible.
 */
async function lockSeats(transaction, { flightId, seatNumbers, seatCount }) {
  if (seatNumbers) {
    return sequelize.query(
      `SELECT id, seat_number, status, version
         FROM flight_seats
        WHERE flight_id = :flightId
          AND seat_number IN (:seatNumbers)
        ORDER BY id
        FOR UPDATE`,
      {
        replacements: { flightId, seatNumbers },
        type: QueryTypes.SELECT,
        transaction,
      }
    );
  }

  return sequelize.query(
    `SELECT id, seat_number, status, version
       FROM flight_seats
      WHERE flight_id = :flightId
        AND status = 'available'
      ORDER BY id
      LIMIT :seatCount
      FOR UPDATE SKIP LOCKED`,
    {
      replacements: { flightId, seatCount },
      type: QueryTypes.SELECT,
      transaction,
    }
  );
}

/**
 * Create a booking.
 *
 * THE TRANSACTION BOUNDARY is this function's body — it opens with
 * sequelize.transaction() and everything inside commits or rolls back as one
 * unit: the seat status flips, the booking row, the seat assignments, and the
 * outbox event. There is no state in which a seat is marked booked but the
 * booking row is missing.
 *
 * Note what is deliberately NOT inside it: the price lookup against the flights
 * service. Holding an open database transaction across a network call means a
 * slow or hanging remote service pins row locks and connections. The price is
 * resolved by the caller, before the transaction opens.
 */
async function createBooking({ userId, flightId, seatNumbers, seatCount, pricePerSeatCents }) {
  return sequelize.transaction(async (transaction) => {
    const lockedSeats = await lockSeats(transaction, { flightId, seatNumbers, seatCount });

    if (seatNumbers) {
      // Every requested seat must exist and still be free. Under READ
      // COMMITTED, FOR UPDATE re-checks the row after the lock is granted, so
      // a status we read here is the committed truth as of this moment.
      const found = new Set(lockedSeats.map((s) => s.seat_number.trim()));
      const missing = seatNumbers.filter((n) => !found.has(n));
      if (missing.length > 0) {
        throw new BookingError(404, 'seat_not_found', `no such seat(s): ${missing.join(', ')}`);
      }

      const taken = lockedSeats.filter((s) => s.status !== 'available');
      if (taken.length > 0) {
        throw new BookingError(
          409,
          'seat_unavailable',
          `seat(s) already taken: ${taken.map((s) => s.seat_number.trim()).join(', ')}`
        );
      }
    } else if (lockedSeats.length < seatCount) {
      throw new BookingError(409, 'insufficient_seats', `only ${lockedSeats.length} seat(s) available`);
    }

    // OPTIMISTIC COMPARE-AND-SWAP.
    //
    // We already hold row locks, so in theory this cannot fail. It is here as a
    // second, independent check: the UPDATE only applies if the row is still at
    // the exact version we read. If a code path ever mutates a seat without
    // taking the lock, this catches it instead of silently overwriting.
    for (const seat of lockedSeats) {
      const updated = await sequelize.query(
        `UPDATE flight_seats
            SET status = 'booked', version = version + 1, updated_at = now()
          WHERE id = :id AND version = :version
        RETURNING id`,
        {
          replacements: { id: seat.id, version: seat.version },
          type: QueryTypes.SELECT,
          transaction,
        }
      );

      if (updated.length !== 1) {
        throw new BookingError(409, 'concurrent_modification', 'seat changed during booking; retry');
      }
    }

    const booking = await Booking.create({
      user_id: userId,
      flight_id: flightId,
      status: 'confirmed',
      total_price_cents: pricePerSeatCents * lockedSeats.length,
    }, { transaction });

    // The partial unique index on (flight_seat_id) WHERE cancelled_at IS NULL
    // makes this INSERT the final arbiter. If everything above somehow let two
    // bookings through for one seat, the second INSERT fails here and its whole
    // transaction rolls back.
    await BookingSeat.bulkCreate(
      lockedSeats.map((seat) => ({ booking_id: booking.id, flight_seat_id: seat.id })),
      { transaction }
    );

    // Written in the SAME transaction as the booking — that is the whole point
    // of the outbox. Either both exist or neither does. A relay publishes it to
    // Kafka afterwards.
    await OutboxEvent.create({
      aggregate_type: 'booking',
      aggregate_id: booking.id,
      event_type: 'booking.confirmed',
      payload: {
        booking_id: String(booking.id),
        user_id: String(userId),
        flight_id: String(flightId),
        seats: lockedSeats.map((s) => s.seat_number.trim()),
        seats_booked: lockedSeats.length,
        total_price_cents: booking.total_price_cents,
      },
    }, { transaction });

    return {
      id: String(booking.id),
      flight_id: String(flightId),
      status: booking.status,
      seats: lockedSeats.map((s) => s.seat_number.trim()),
      total_price_cents: booking.total_price_cents,
      created_at: booking.created_at,
    };
  });
}

/**
 * Cancel a booking and release its seats.
 *
 * NO IDEMPOTENCY KEY IS REQUIRED, and that is a design statement rather than an
 * omission. Creating a booking is not naturally idempotent — "book me a seat"
 * sent twice legitimately means two seats, so only a client-supplied key can
 * distinguish a retry from a genuine second request (DECISIONS.md 005).
 * Cancellation is different: the end state of "cancel booking 7" is the same
 * however many times it is applied. So this endpoint is made idempotent by its
 * own semantics — a repeat cancellation returns the same 200 and the same body
 * as the first, rather than an error.
 *
 * That difference between "naturally idempotent" and "needs a key to become
 * idempotent" is the useful distinction, not the header.
 *
 * LOCK ORDER: the booking row first, then its seats ORDER BY id. Booking
 * creation locks seat rows and then INSERTs a new booking row — it never waits
 * on an existing booking row — so the two paths cannot form a cycle.
 */
async function cancelBooking({ userId, bookingId }) {
  return sequelize.transaction(async (transaction) => {
    // Lock the booking row so two concurrent cancellations serialise. The
    // second one waits here, then observes status='cancelled' and returns the
    // same answer instead of releasing the seats twice.
    const [booking] = await sequelize.query(
      `SELECT id, user_id, flight_id, status, total_price_cents, created_at
         FROM bookings
        WHERE id = :bookingId
        FOR UPDATE`,
      { replacements: { bookingId }, type: QueryTypes.SELECT, transaction }
    );

    if (!booking) {
      throw new BookingError(404, 'booking_not_found', 'booking not found');
    }

    // Scoped to the caller. Reported as 404 rather than 403 so the endpoint does
    // not confirm that a booking id exists to someone who does not own it.
    if (String(booking.user_id) !== String(userId)) {
      throw new BookingError(404, 'booking_not_found', 'booking not found');
    }

    const seats = await sequelize.query(
      `SELECT bs.id AS booking_seat_id, fs.id AS flight_seat_id, fs.seat_number
         FROM booking_seats bs
         JOIN flight_seats fs ON fs.id = bs.flight_seat_id
        WHERE bs.booking_id = :bookingId
          AND bs.cancelled_at IS NULL
        ORDER BY fs.id
        FOR UPDATE OF fs`,
      { replacements: { bookingId }, type: QueryTypes.SELECT, transaction }
    );

    // Already cancelled: return the same response the first cancellation gave.
    if (booking.status === 'cancelled') {
      return {
        id: String(booking.id),
        flight_id: String(booking.flight_id),
        status: 'cancelled',
        seats_released: 0,
        already_cancelled: true,
      };
    }

    if (booking.status !== 'confirmed') {
      throw new BookingError(
        409,
        'not_cancellable',
        `a booking with status "${booking.status}" cannot be cancelled`
      );
    }

    // Setting cancelled_at is what removes these rows from the partial unique
    // index `UNIQUE (flight_seat_id) WHERE cancelled_at IS NULL`, which is
    // precisely why that index is partial: the seat becomes bookable again
    // while the historical record of who held it survives. A DELETE would free
    // the seat too, and destroy the audit trail doing it.
    await sequelize.query(
      `UPDATE booking_seats
          SET cancelled_at = now()
        WHERE booking_id = :bookingId AND cancelled_at IS NULL`,
      { replacements: { bookingId }, transaction }
    );

    if (seats.length > 0) {
      await sequelize.query(
        `UPDATE flight_seats
            SET status = 'available', version = version + 1, updated_at = now()
          WHERE id IN (:seatIds)`,
        { replacements: { seatIds: seats.map((s) => s.flight_seat_id) }, transaction }
      );
    }

    await sequelize.query(
      `UPDATE bookings SET status = 'cancelled', updated_at = now() WHERE id = :bookingId`,
      { replacements: { bookingId }, transaction }
    );

    // Same transaction as the state change, exactly as on the booking path.
    await OutboxEvent.create({
      aggregate_type: 'booking',
      aggregate_id: booking.id,
      event_type: 'booking.cancelled',
      payload: {
        booking_id: String(booking.id),
        user_id: String(booking.user_id),
        flight_id: String(booking.flight_id),
        seats: seats.map((s) => s.seat_number.trim()),
        seats_released: seats.length,
        refund_amount_cents: booking.total_price_cents,
      },
    }, { transaction });

    return {
      id: String(booking.id),
      flight_id: String(booking.flight_id),
      status: 'cancelled',
      seats_released: seats.length,
      seats: seats.map((s) => s.seat_number.trim()),
      refund_amount_cents: booking.total_price_cents,
    };
  });
}

module.exports = { createBooking, cancelBooking, BookingError };
