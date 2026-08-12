'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.createTable('booking_seats', {
      id: {
        type: Sequelize.BIGINT,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      booking_id: {
        type: Sequelize.BIGINT,
        allowNull: false,
        references: { model: 'bookings', key: 'id' },
      },
      flight_seat_id: {
        type: Sequelize.BIGINT,
        allowNull: false,
        references: { model: 'flight_seats', key: 'id' },
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('now()'),
      },
      // NULL means "this seat assignment is still live". Set on cancellation,
      // so history is preserved rather than deleted.
      cancelled_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
    });

    // ========================================================================
    // THE DOUBLE-BOOKING BACKSTOP.
    //
    // A PARTIAL unique index: it only indexes rows matching the WHERE clause,
    // so it enforces "at most one ACTIVE assignment per seat" while still
    // allowing any number of cancelled ones for the same seat.
    //
    // This is the last line of defence. Application-level locking should mean
    // two concurrent bookings never both reach this point — but if that logic
    // is ever wrong, the database rejects the second INSERT outright. The
    // invariant survives bugs in the code above it.
    // ========================================================================
    await queryInterface.addIndex('booking_seats', {
      name: 'idx_booking_seats_active_seat',
      fields: ['flight_seat_id'],
      unique: true,
      where: { cancelled_at: null },
    });
  },

  async down (queryInterface) {
    await queryInterface.dropTable('booking_seats');
  }
};
