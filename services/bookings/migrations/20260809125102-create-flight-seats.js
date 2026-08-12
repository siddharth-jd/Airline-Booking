'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.createTable('flight_seats', {
      id: {
        type: Sequelize.BIGINT,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      // No foreign key: this points into flights_db, a different database.
      // Postgres cannot enforce an FK across databases — that is the service
      // boundary being enforced physically rather than by convention.
      flight_id: {
        type: Sequelize.BIGINT,
        allowNull: false,
      },
      seat_number: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      status: {
        type: Sequelize.TEXT,
        allowNull: false,
        defaultValue: 'available',
      },
      // Optimistic concurrency control: every successful write bumps this.
      // A writer that read version N can only commit if the row is still at N.
      version: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('now()'),
      },
    });

    await queryInterface.addConstraint('flight_seats', {
      type: 'check',
      fields: ['status'],
      name: 'flight_seats_status_valid',
      where: Sequelize.literal("status IN ('available','held','booked')"),
    });

    await queryInterface.addConstraint('flight_seats', {
      type: 'unique',
      fields: ['flight_id', 'seat_number'],
      name: 'flight_seats_flight_id_seat_number_key',
    });

    await queryInterface.addIndex('flight_seats', {
      name: 'idx_flight_seats_flight',
      fields: ['flight_id'],
    });
  },

  async down (queryInterface) {
    await queryInterface.dropTable('flight_seats');
  }
};
