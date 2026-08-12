'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    // One row per notification this service decided to send.
    //
    // `event_id` is the PRIMARY KEY, which makes this table its own inbox: the
    // insert that records the notification is the same insert that claims the
    // event. A redelivered event hits the primary key and the transaction
    // aborts, so no duplicate notification goes out.
    //
    // NOTE this service keeps its OWN dedup state. The flights service's
    // processed_events table is useless to it — the two are separate consumer
    // groups with separate offsets, processing the same events at different
    // times and independently of each other. Shared dedup state would recreate
    // exactly the coupling that separate services exist to remove.
    await queryInterface.createTable('notifications', {
      event_id: {
        type: Sequelize.TEXT,
        primaryKey: true,
        allowNull: false,
      },
      user_id: {
        type: Sequelize.BIGINT,
        allowNull: false,
      },
      booking_id: {
        type: Sequelize.BIGINT,
        allowNull: false,
      },
      channel: {
        type: Sequelize.TEXT,
        allowNull: false,
        defaultValue: 'email',
      },
      subject: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      body: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      // 'pending' -> 'sent' | 'failed'. The row is written as 'pending' inside
      // the claiming transaction and only marked 'sent' after the delivery
      // attempt, so a crash mid-send leaves visible evidence rather than a
      // silent gap.
      status: {
        type: Sequelize.TEXT,
        allowNull: false,
        defaultValue: 'pending',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('now()'),
      },
      sent_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
    });

    await queryInterface.addConstraint('notifications', {
      type: 'check',
      fields: ['status'],
      name: 'notifications_status_valid',
      where: Sequelize.literal("status IN ('pending','sent','failed')"),
    });

    await queryInterface.addIndex('notifications', {
      name: 'idx_notifications_user',
      fields: ['user_id'],
    });

    // Partial index over undelivered rows only — it stays small as the table
    // grows, and it is what a retry sweeper would scan.
    await queryInterface.addIndex('notifications', {
      name: 'idx_notifications_undelivered',
      fields: ['created_at'],
      where: { status: 'pending' },
    });
  },

  async down (queryInterface) {
    await queryInterface.dropTable('notifications');
  }
};
