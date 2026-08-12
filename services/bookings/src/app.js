const express = require('express');
const bookingRoutes = require('./routes/bookings');

const app = express();

app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.use('/bookings', bookingRoutes);

// Seat maps live under /flights/:id/seats even though this is the bookings
// service, because seat inventory is owned here. The gateway routes that one
// path to this service; see src/routes/seats.js.
app.use('/flights', require('./routes/seats'));

// Demonstration only — the same booking flow with its concurrency control
// stripped out, so the race condition can be observed on demand. Guarded by an
// env flag so it can never be reachable outside local development.
if (process.env.ENABLE_UNSAFE_DEMO === 'true') {
  app.use('/demo/unsafe-bookings', require('./routes/unsafe'));
  console.warn('WARNING: unsafe demo endpoint mounted at POST /demo/unsafe-bookings');
}

app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({ error: status === 500 ? 'internal server error' : err.message });
});

module.exports = app;
