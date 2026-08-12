'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    // TRANSACTIONAL OUTBOX.
    //
    // The problem: a booking must both (a) commit to the database and (b) emit
    // a Kafka event, atomically. You cannot put a Kafka publish inside a
    // Postgres transaction — if the publish succeeds and the transaction then
    // rolls back, you have announced a booking that does not exist; if the
    // transaction commits and the publish fails, the event is lost forever.
    //
    // The fix: write the event as a ROW, in the same transaction as the
    // booking. It commits atomically with the booking or not at all. A
    // separate relay process then reads unpublished rows and pushes them to
    // Kafka, marking them published afterwards.
    //
    // This gives at-least-once delivery: a crash between publish and mark
    // means the row is republished later, so consumers must be idempotent.
    await queryInterface.createTable('outbox', {
      id: {
        type: Sequelize.BIGINT,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      aggregate_type: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      aggregate_id: {
        type: Sequelize.BIGINT,
        allowNull: false,
      },
      event_type: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      payload: {
        type: Sequelize.JSONB,
        allowNull: false,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('now()'),
      },
      published_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
    });

    // Partial index: the relay only ever queries unpublished rows, and this
    // index shrinks as rows are published rather than growing with the table.
    await queryInterface.addIndex('outbox', {
      name: 'idx_outbox_unpublished',
      fields: ['created_at'],
      where: { published_at: null },
    });
  },

  async down (queryInterface) {
    await queryInterface.dropTable('outbox');
  }
};
