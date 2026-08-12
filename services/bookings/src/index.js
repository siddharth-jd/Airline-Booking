require('dotenv').config();
const app = require('./app');
const { sequelize } = require('../models');

const PORT = process.env.PORT;

async function start() {
  await sequelize.authenticate();
  app.listen(PORT, () => console.log(`bookings-service listening on :${PORT}`));
}

start().catch((err) => {
  console.error('failed to start bookings-service:', err);
  process.exit(1);
});
