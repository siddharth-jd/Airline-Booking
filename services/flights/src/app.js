const express = require('express');
const flightRoutes = require('./routes/flights');
const airportRoutes = require('./routes/airports');

const app = express();

app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.use('/flights', flightRoutes);
app.use('/airports', airportRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'internal server error' });
});

module.exports = app;
