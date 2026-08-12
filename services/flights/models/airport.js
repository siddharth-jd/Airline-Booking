'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Airport extends Model {
    static associate(models) {
      Airport.hasMany(models.Flight, { foreignKey: 'origin_code', as: 'departures' });
      Airport.hasMany(models.Flight, { foreignKey: 'destination_code', as: 'arrivals' });
    }
  }

  Airport.init({
    code: {
      type: DataTypes.CHAR(3),
      primaryKey: true,
      allowNull: false,
    },
    name: { type: DataTypes.TEXT, allowNull: false },
    city: { type: DataTypes.TEXT, allowNull: false },
    country: { type: DataTypes.TEXT, allowNull: false },
  }, {
    sequelize,
    modelName: 'Airport',
    tableName: 'airports',
    underscored: true,
    timestamps: false,
  });

  return Airport;
};
