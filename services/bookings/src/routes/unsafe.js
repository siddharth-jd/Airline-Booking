const express = require('express');
const { QueryTypes } = require('sequelize');
const authenticate = require('../middleware/authenticate');
const { Booking, BookingSeat, sequelize } = require('../../models');

const router = express.Router();
router.use(authenticate);

/**
 * ===========================================================================
 * DELIBERATELY BROKEN. This endpoint exists to demonstrate the race condition
 * that the real POST /bookings prevents. It is never mounted in production.
 *
 * What has been removed, and why each one matters:
 *
 *   1. No FOR UPDATE on the SELECT.  Two transactions can read the SAME seat
 *      as 'available' at the same time, because a plain read takes no lock.
 *      This is the check-then-act race: the check is stale by the time you act.
 *
 *   2. No version compare-and-swap on the UPDATE.  The write lands
 *      unconditionally, so the second writer silently overwrites the first.
 *
 *   3. No booking_seats insert.  The partial unique index would otherwise
 *      still catch the duplicate — the database backstop is strong enough to
 *      hold the invariant on its own. To show the race, it must be bypassed.
 *
 * The artificial delay between read and write widens the window so the race
 * reproduces reliably at low concurrency instead of needing thousands of
 * requests to hit by chance.
 * ===========================================================================
 */
router.post('/', async (req, res, next) => {
  const { flight_id, seat_number, delay_ms = 100 } = req.body;

  if (!flight_id || !seat_number) {
    return res.status(400).json({ error: 'flight_id and seat_number are required' });
  }

  try {
    const result = await sequelize.transaction(async (transaction) => {
      // (1) Plain read — no lock taken.
      const [seat] = await sequelize.query(
        `SELECT id, seat_number, status
           FROM flight_seats
          WHERE flight_id = :flight_id AND seat_number = :seat_number`,
        {
          replacements: { flight_id, seat_number },
          type: QueryTypes.SELECT,
          transaction,
        }
      );

      if (!seat) return { status: 404, body: { error: 'seat not found' } };
      if (seat.status !== 'available') {
        return { status: 409, body: { error: 'seat already taken' } };
      }

      // Widen the race window. Every concurrent request has now read
      // 'available' and each believes it may proceed.
      await new Promise((resolve) => setTimeout(resolve, delay_ms));

      // (2) Unconditional write — no version check.
      await sequelize.query(
        `UPDATE flight_seats
            SET status = 'booked', version = version + 1, updated_at = now()
          WHERE id = :id`,
        { replacements: { id: seat.id }, type: QueryTypes.UPDATE, transaction }
      );

      const booking = await Booking.create({
        user_id: req.user.id,
        flight_id,
        status: 'confirmed',
        total_price_cents: 0,
      }, { transaction });

      // (3) booking_seats deliberately NOT written — see the header comment.

      return {
        status: 201,
        body: {
          id: String(booking.id),
          seat: seat.seat_number.trim(),
          warning: 'created via the intentionally unsafe endpoint',
        },
      };
    });

    return res.status(result.status).json(result.body);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
