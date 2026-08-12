require('dotenv').config();

const base = {
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  dialect: 'postgres',

  // Track which seeders have run, in a SequelizeData table, exactly as
  // migrations are tracked in SequelizeMeta.
  //
  // The default is 'none', meaning `db:seed:all` re-runs every seeder every
  // time — which fails on the second run when a bulkInsert hits a unique
  // constraint. Tracking makes seeding idempotent, so the startup job can run
  // it unconditionally and a container restart is harmless.
  seederStorage: 'sequelize',
};

module.exports = {
  development: base,
  test: base,
  production: base,
};
