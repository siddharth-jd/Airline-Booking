require('dotenv').config();
const app = require('./app');
const { sequelize } = require('../models');

const PORT = process.env.PORT;

async function start() {
  await sequelize.authenticate();
  app.listen(PORT, () => console.log(`flights-service listening on :${PORT}`));
}

start().catch((err) => {
  console.error('failed to start flights-service:', err);
  process.exit(1);
});
