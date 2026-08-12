'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    // THE INBOX — the consumer-side counterpart to the producer-side outbox.
    //
    // The relay delivers at-least-once, so this service WILL occasionally see
    // the same event twice. Most event handlers are not naturally idempotent:
    // "seats_available = seats_available - 1" applied twice is simply wrong,
    // and nothing about the message itself reveals that it is a repeat.
    //
    // Recording each event_id here, in the SAME transaction that applies the
    // event's effect, makes replay harmless. A duplicate hits the primary key,
    // the transaction aborts, and the effect is not applied a second time.
    // Effect and record commit together or not at all — the same reasoning as
    // the outbox, mirrored.
    await queryInterface.createTable('processed_events', {
      event_id: {
        type: Sequelize.TEXT,
        primaryKey: true,
        allowNull: false,
      },
      event_type: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      processed_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('now()'),
      },
    });
  },

  async down (queryInterface) {
    await queryInterface.dropTable('processed_events');
  }
};
