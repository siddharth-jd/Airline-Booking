const express = require('express');
const { Op } = require('sequelize');
const { Flight, Airport } = require('../../models');

const router = express.Router();

const AIRPORT_ATTRIBUTES = ['code', 'name', 'city'];

router.get('/', async (req, res) => {
  const { origin, destination, date } = req.query;

  if (!origin || !destination || !date) {
    return res.status(400).json({ error: 'origin, destination and date are required' });
  }

  const dayStart = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(dayStart.getTime())) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  const flights = await Flight.findAll({
    where: {
      origin_code: origin.toUpperCase(),
      destination_code: destination.toUpperCase(),
      departure_time: { [Op.gte]: dayStart, [Op.lt]: dayEnd },
      seats_available: { [Op.gt]: 0 },
    },
    include: [
      { model: Airport, as: 'origin', attributes: AIRPORT_ATTRIBUTES },
      { model: Airport, as: 'destination', attributes: AIRPORT_ATTRIBUTES },
    ],
    order: [['departure_time', 'ASC']],
  });

  return res.json({ count: flights.length, flights });
});

router.get('/:id', async (req, res) => {
  const flight = await Flight.findByPk(req.params.id, {
    include: [
      { model: Airport, as: 'origin', attributes: AIRPORT_ATTRIBUTES },
      { model: Airport, as: 'destination', attributes: AIRPORT_ATTRIBUTES },
    ],
  });

  if (!flight) {
    return res.status(404).json({ error: 'flight not found' });
  }

  return res.json(flight);
});

module.exports = router;
