// The booking service cannot read flights_db — it has no CONNECT privilege on
// it. Flight details come over HTTP, which is the service boundary working as
// intended.
//
// This call is made BEFORE the booking transaction opens, never inside it: a
// database transaction must not stay open across a network round-trip.
const TIMEOUT_MS = 3000;

async function getFlight(flightId) {
  const url = `${process.env.FLIGHTS_SERVICE_URL}/flights/${flightId}`;

  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    const error = new Error('flights service unavailable');
    error.status = 503;
    throw error;
  }

  if (response.status === 404) return null;

  if (!response.ok) {
    const error = new Error('flights service error');
    error.status = 502;
    throw error;
  }

  return response.json();
}

module.exports = { getFlight };
