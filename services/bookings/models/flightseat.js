'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class FlightSeat extends Model {
    static associate(models) {
      FlightSeat.hasMany(models.BookingSeat, { foreignKey: 'flight_seat_id', as: 'assignments' });
    }
  }

  FlightSeat.init({
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
    },
    flight_id: { type: DataTypes.BIGINT, allowNull: false },
    seat_number: { type: DataTypes.TEXT, allowNull: false },
    status: { type: DataTypes.TEXT, allowNull: false, defaultValue: 'available' },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  }, {
    sequelize,
    modelName: 'FlightSeat',
    tableName: 'flight_seats',
    underscored: true,
    createdAt: false,
    updatedAt: 'updated_at',
  });

  return FlightSeat;
};
