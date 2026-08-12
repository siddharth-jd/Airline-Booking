const jwt = require('jsonwebtoken');

// Verifies the JWT issued by the auth service. Note there is no network call
// and no database lookup: the signature is checked locally with the shared
// secret. That is the point of a JWT — the booking service can authenticate a
// request even if the auth service is down, and it never needs read access to
// auth_db.
function authenticate(req, res, next) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'missing bearer token' });
  }

  try {
    const claims = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: String(claims.sub), email: claims.email };
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'invalid or expired token' });
  }
}

module.exports = authenticate;
