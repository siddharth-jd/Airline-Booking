'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class OutboxEvent extends Model {}

  OutboxEvent.init({
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
    },
    aggregate_type: { type: DataTypes.TEXT, allowNull: false },
    aggregate_id: { type: DataTypes.BIGINT, allowNull: false },
    event_type: { type: DataTypes.TEXT, allowNull: false },
    payload: { type: DataTypes.JSONB, allowNull: false },
    published_at: { type: DataTypes.DATE, allowNull: true },
  }, {
    sequelize,
    modelName: 'OutboxEvent',
    tableName: 'outbox',
    underscored: true,
    createdAt: 'created_at',
    updatedAt: false,
  });

  return OutboxEvent;
};
