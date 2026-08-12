const express = require('express');
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../../models');

const router = express.Router();

// GET /flights/:flightId/seats
//
// Seat-level availability for one flight. Public and unauthenticated, like
// flight search — which seats are free is not private information, and
// requiring a login to look would stop anyone browsing before signing up.
//
// NOTE the path. Seat inventory is owned by the BOOKING service (DECISIONS.md
// 001), but from a client's point of view "seats on a flight" belongs under
// /flights. The gateway routes this one path to bookings while every other
// /flights route goes to the flights service, so the public API reads as one
// coherent surface without the services having to merge. That composition is a
// large part of what a gateway is for.
//
// This is the AUTHORITATIVE seat state, read straight from the booking
// service's own tables — not the eventually-consistent `seats_available`
// counter the flights service serves in search results.
router.get('/:flightId/seats', async (req, res) => {
  const flightId = Number(req.params.flightId);
  if (!Number.isInteger(flightId) || flightId <= 0) {
    return res.status(400).json({ error: 'flightId must be a positive integer' });
  }

  const seats = await sequelize.query(
    `SELECT seat_number, status
       FROM flight_seats
      WHERE flight_id = :flightId
      ORDER BY
        -- '10A' must sort after '9A', so order by the numeric row first and
        -- the letter second rather than lexically by the whole label.
        (regexp_replace(seat_number, '[^0-9]', '', 'g'))::int,
        regexp_replace(seat_number, '[^A-Za-z]', '', 'g')`,
    { replacements: { flightId }, type: QueryTypes.SELECT }
  );

  if (seats.length === 0) {
    return res.status(404).json({ error: 'no seat map for that flight' });
  }

  return res.json({
    flight_id: String(flightId),
    total: seats.length,
    available: seats.filter((s) => s.status === 'available').length,
    seats: seats.map((s) => ({ seat_number: s.seat_number.trim(), status: s.status })),
  });
});

module.exports = router;