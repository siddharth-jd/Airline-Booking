'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Flight extends Model {
    static associate(models) {
      Flight.belongsTo(models.Airport, { foreignKey: 'origin_code', as: 'origin' });
      Flight.belongsTo(models.Airport, { foreignKey: 'destination_code', as: 'destination' });
    }
  }

  Flight.init({
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
    },
    flight_number: { type: DataTypes.TEXT, allowNull: false },
    origin_code: { type: DataTypes.CHAR(3), allowNull: false },
    destination_code: { type: DataTypes.CHAR(3), allowNull: false },
    departure_time: { type: DataTypes.DATE, allowNull: false },
    arrival_time: { type: DataTypes.DATE, allowNull: false },
    aircraft_capacity: { type: DataTypes.INTEGER, allowNull: false },
    seats_available: { type: DataTypes.INTEGER, allowNull: false },
    price_cents: { type: DataTypes.INTEGER, allowNull: false },
  }, {
    sequelize,
    modelName: 'Flight',
    tableName: 'flights',
    underscored: true,
    createdAt: 'created_at',
    updatedAt: false,
  });

  return Flight;
};
