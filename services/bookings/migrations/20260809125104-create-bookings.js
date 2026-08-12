'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.createTable('bookings', {
      id: {
        type: Sequelize.BIGINT,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      // Points into auth_db; no FK, same cross-database reason as flight_seats.
      user_id: {
        type: Sequelize.BIGINT,
        allowNull: false,
      },
      flight_id: {
        type: Sequelize.BIGINT,
        allowNull: false,
      },
      status: {
        type: Sequelize.TEXT,
        allowNull: false,
        defaultValue: 'pending',
      },
      total_price_cents: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('now()'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('now()'),
      },
    });

    await queryInterface.addConstraint('bookings', {
      type: 'check',
      fields: ['status'],
      name: 'bookings_status_valid',
      where: Sequelize.literal("status IN ('pending','confirmed','cancelled','failed')"),
    });

    await queryInterface.addIndex('bookings', {
      name: 'idx_bookings_user',
      fields: ['user_id'],
    });
  },

  async down (queryInterface) {
    await queryInterface.dropTable('bookings');
  }
};
