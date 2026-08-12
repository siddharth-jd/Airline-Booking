'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.createTable('flights', {
      id: {
        type: Sequelize.BIGINT,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      flight_number: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      origin_code: {
        type: Sequelize.CHAR(3),
        allowNull: false,
        references: { model: 'airports', key: 'code' },
      },
      destination_code: {
        type: Sequelize.CHAR(3),
        allowNull: false,
        references: { model: 'airports', key: 'code' },
      },
      departure_time: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      arrival_time: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      aircraft_capacity: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      seats_available: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      price_cents: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('now()'),
      },
    });

    await queryInterface.addConstraint('flights', {
      type: 'check',
      fields: ['destination_code'],
      name: 'flights_distinct_endpoints',
      where: Sequelize.literal('destination_code <> origin_code'),
    });

    await queryInterface.addConstraint('flights', {
      type: 'check',
      fields: ['arrival_time'],
      name: 'flights_arrival_after_departure',
      where: Sequelize.literal('arrival_time > departure_time'),
    });

    await queryInterface.addConstraint('flights', {
      type: 'check',
      fields: ['seats_available'],
      name: 'flights_seats_available_within_capacity',
      where: Sequelize.literal('seats_available >= 0 AND seats_available <= aircraft_capacity'),
    });

    await queryInterface.addIndex('flights', {
      name: 'idx_flights_route_time',
      fields: ['origin_code', 'destination_code', 'departure_time'],
    });
  },

  async down (queryInterface) {
    await queryInterface.dropTable('flights');
  }
};
