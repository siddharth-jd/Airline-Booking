const express = require('express');
const { Airport } = require('../../models');

const router = express.Router();

router.get('/', async (req, res) => {
  const airports = await Airport.findAll({ order: [['code', 'ASC']] });
  return res.json({ count: airports.length, airports });
});

module.exports = router;
