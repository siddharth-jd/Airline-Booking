'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.createTable('idempotency_keys', {
      // The client-supplied key IS the primary key. Two concurrent retries of
      // the same request therefore race on a unique index: exactly one INSERT
      // wins, the loser knows a request with this key is already in flight.
      key: {
        type: Sequelize.TEXT,
        primaryKey: true,
        allowNull: false,
      },
      // Scopes the key to one user, so a key guessed or reused by a different
      // user cannot return someone else's booking.
      user_id: {
        type: Sequelize.BIGINT,
        allowNull: false,
      },
      // Fingerprint of the request body. A retry must carry the SAME payload;
      // reusing a key with different parameters is a client bug, not a retry,
      // and must be rejected rather than silently replayed.
      request_fingerprint: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      booking_id: {
        type: Sequelize.BIGINT,
        allowNull: true,
        references: { model: 'bookings', key: 'id' },
      },
      status: {
        type: Sequelize.TEXT,
        allowNull: false,
        defaultValue: 'in_progress',
      },
      // The stored response, replayed verbatim on a retry.
      response_status: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      response_body: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('now()'),
      },
    });

    await queryInterface.addConstraint('idempotency_keys', {
      type: 'check',
      fields: ['status'],
      name: 'idempotency_keys_status_valid',
      where: Sequelize.literal("status IN ('in_progress','completed','failed')"),
    });
  },

  async down (queryInterface) {
    await queryInterface.dropTable('idempotency_keys');
  }
};
