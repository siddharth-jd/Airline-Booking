const express = require('express');
const bcrypt = require('bcrypt');
const { User } = require('../../models');
const { signAccessToken } = require('../lib/jwt');

const router = express.Router();
const BCRYPT_COST_FACTOR = 12;

router.post('/signup', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const password_hash = await bcrypt.hash(password, BCRYPT_COST_FACTOR);

  try {
    const user = await User.create({ email, password_hash });
    const token = signAccessToken(user);
    return res.status(201).json({ id: user.id, email: user.email, token });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: 'email already registered' });
    }
    throw err;
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const user = await User.findOne({ where: { email } });
  const passwordMatches = user && (await bcrypt.compare(password, user.password_hash));

  if (!passwordMatches) {
    return res.status(401).json({ error: 'invalid credentials' });
  }

  const token = signAccessToken(user);
  return res.json({ token });
});

module.exports = router;
