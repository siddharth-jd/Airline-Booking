'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Booking extends Model {
    static associate(models) {
      Booking.hasMany(models.BookingSeat, { foreignKey: 'booking_id', as: 'seats' });
    }
  }

  Booking.init({
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
    },
    user_id: { type: DataTypes.BIGINT, allowNull: false },
    flight_id: { type: DataTypes.BIGINT, allowNull: false },
    status: { type: DataTypes.TEXT, allowNull: false, defaultValue: 'pending' },
    total_price_cents: { type: DataTypes.INTEGER, allowNull: false },
  }, {
    sequelize,
    modelName: 'Booking',
    tableName: 'bookings',
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  });

  return Booking;
};
