'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Notification extends Model {}

  Notification.init({
    event_id: {
      type: DataTypes.TEXT,
      primaryKey: true,
      allowNull: false,
    },
    user_id: { type: DataTypes.BIGINT, allowNull: false },
    booking_id: { type: DataTypes.BIGINT, allowNull: false },
    channel: { type: DataTypes.TEXT, allowNull: false, defaultValue: 'email' },
    subject: { type: DataTypes.TEXT, allowNull: false },
    body: { type: DataTypes.TEXT, allowNull: false },
    status: { type: DataTypes.TEXT, allowNull: false, defaultValue: 'pending' },
    sent_at: { type: DataTypes.DATE, allowNull: true },
  }, {
    sequelize,
    modelName: 'Notification',
    tableName: 'notifications',
    underscored: true,
    createdAt: 'created_at',
    updatedAt: false,
  });

  return Notification;
};
