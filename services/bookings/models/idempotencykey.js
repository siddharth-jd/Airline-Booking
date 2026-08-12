'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class IdempotencyKey extends Model {}

  IdempotencyKey.init({
    key: {
      type: DataTypes.TEXT,
      primaryKey: true,
      allowNull: false,
    },
    user_id: { type: DataTypes.BIGINT, allowNull: false },
    request_fingerprint: { type: DataTypes.TEXT, allowNull: false },
    booking_id: { type: DataTypes.BIGINT, allowNull: true },
    status: { type: DataTypes.TEXT, allowNull: false, defaultValue: 'in_progress' },
    response_status: { type: DataTypes.INTEGER, allowNull: true },
    response_body: { type: DataTypes.JSONB, allowNull: true },
  }, {
    sequelize,
    modelName: 'IdempotencyKey',
    tableName: 'idempotency_keys',
    underscored: true,
    createdAt: 'created_at',
    updatedAt: false,
  });

  return IdempotencyKey;
};
