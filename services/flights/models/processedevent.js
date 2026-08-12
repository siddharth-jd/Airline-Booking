'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class ProcessedEvent extends Model {}

  ProcessedEvent.init({
    event_id: {
      type: DataTypes.TEXT,
      primaryKey: true,
      allowNull: false,
    },
    event_type: { type: DataTypes.TEXT, allowNull: false },
  }, {
    sequelize,
    modelName: 'ProcessedEvent',
    tableName: 'processed_events',
    underscored: true,
    createdAt: 'processed_at',
    updatedAt: false,
  });

  return ProcessedEvent;
};
