const express = require('express');
const authenticate = require('../middleware/authenticate');
const idempotency = require('../services/idempotency');
const flightsClient = require('../services/flightsClient');
const { createBooking, cancelBooking, BookingError } = require('../services/bookingService');
const { Booking, BookingSeat, FlightSeat } = require('../../models');

const router = express.Router();

router.use(authenticate);

function validate(body) {
  const { flight_id, seat_numbers, seat_count } = body;

  if (!flight_id) return 'flight_id is required';

  const hasSeatNumbers = Array.isArray(seat_numbers) && seat_numbers.length > 0;
  const hasSeatCount = Number.isInteger(seat_count) && seat_count > 0;

  if (hasSeatNumbers === hasSeatCount) {
    return 'provide exactly one of seat_numbers (specific seats) or seat_count (any seats)';
  }
  if (hasSeatNumbers && new Set(seat_numbers).size !== seat_numbers.length) {
    return 'seat_numbers contains duplicates';
  }
  if (hasSeatCount && seat_count > 9) {
    return 'seat_count may not exceed 9';
  }
  return null;
}

router.post('/', async (req, res, next) => {
  const key = req.get('idempotency-key');
  if (!key) {
    return res.status(400).json({ error: 'Idempotency-Key header is required' });
  }

  const validationError = validate(req.body);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  // Claim the key first. A retry of an already-completed request never reaches
  // the booking logic at all — it replays the stored response.
  const claim = await idempotency.claim({ key, userId: req.user.id, body: req.body });
  if (!claim.claimed) {
    return res.status(claim.replay.status).json(claim.replay.body);
  }

  try {
    const flight = await flightsClient.getFlight(req.body.flight_id);
    if (!flight) {
      const body = { error: 'flight not found' };
      await idempotency.complete({ key, status: 'failed', responseStatus: 404, responseBody: body });
      return res.status(404).json(body);
    }

    const booking = await createBooking({
      userId: req.user.id,
      flightId: req.body.flight_id,
      seatNumbers: req.body.seat_numbers,
      seatCount: req.body.seat_count,
      pricePerSeatCents: flight.price_cents,
    });

    await idempotency.complete({
      key,
      status: 'completed',
      responseStatus: 201,
      responseBody: booking,
      bookingId: booking.id,
    });

    return res.status(201).json(booking);
  } catch (err) {
    if (err instanceof BookingError) {
      const body = { error: err.message, code: err.code };
      // A business failure (seat taken) is a real, final answer — store it so a
      // retry gets the same reply rather than a different one.
      await idempotency.complete({
        key,
        status: 'failed',
        responseStatus: err.status,
        responseBody: body,
      });
      return res.status(err.status).json(body);
    }

    // An infrastructure failure is NOT a final answer. Release the key so the
    // client can genuinely retry; leaving it claimed would wedge that key
    // forever.
    await idempotency.complete({ key, status: 'failed', responseStatus: null, responseBody: null })
      .catch(() => {});
    return next(err);
  }
});

router.get('/', async (req, res) => {
  const bookings = await Booking.findAll({
    where: { user_id: req.user.id },
    include: [{
      model: BookingSeat,
      as: 'seats',
      include: [{ model: FlightSeat, as: 'seat', attributes: ['seat_number'] }],
    }],
    order: [['created_at', 'DESC']],
  });

  return res.json({ count: bookings.length, bookings });
});

router.get('/:id', async (req, res) => {
  const booking = await Booking.findOne({
    // Scoped to the caller: one user must not be able to read another's booking
    // by guessing an id.
    where: { id: req.params.id, user_id: req.user.id },
    include: [{
      model: BookingSeat,
      as: 'seats',
      include: [{ model: FlightSeat, as: 'seat', attributes: ['seat_number'] }],
    }],
  });

  if (!booking) return res.status(404).json({ error: 'booking not found' });
  return res.json(booking);
});

// POST rather than DELETE, because nothing is deleted: the booking transitions
// to 'cancelled' and its seat assignments are stamped with cancelled_at. The
// history survives, which is what makes the partial unique index worthwhile.
//
// No Idempotency-Key header is required — cancellation is idempotent by its own
// semantics, so a repeat returns the same 200 rather than an error. See the
// comment on cancelBooking().
router.post('/:id/cancel', async (req, res, next) => {
  try {
    const result = await cancelBooking({ userId: req.user.id, bookingId: req.params.id });
    return res.json(result);
  } catch (err) {
    if (err instanceof BookingError) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    return next(err);
  }
});

module.exports = router;
