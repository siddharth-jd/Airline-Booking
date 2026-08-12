'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class BookingSeat extends Model {
    static associate(models) {
      BookingSeat.belongsTo(models.Booking, { foreignKey: 'booking_id', as: 'booking' });
      BookingSeat.belongsTo(models.FlightSeat, { foreignKey: 'flight_seat_id', as: 'seat' });
    }
  }

  BookingSeat.init({
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
    },
    booking_id: { type: DataTypes.BIGINT, allowNull: false },
    flight_seat_id: { type: DataTypes.BIGINT, allowNull: false },
    cancelled_at: { type: DataTypes.DATE, allowNull: true },
  }, {
    sequelize,
    modelName: 'BookingSeat',
    tableName: 'booking_seats',
    underscored: true,
    createdAt: 'created_at',
    updatedAt: false,
  });

  return BookingSeat;
};
