const AWS = require("aws-sdk");
const { v4: uuidv4 } = require("uuid");
const log = require("../utils/logger");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.createNotification = async (userId, type, message, details = {}) => {
  const notificationsTableName = process.env.NOTIFICATIONS_TABLE_NAME;
  if (!notificationsTableName) {
    log.error("Environment variable NOTIFICATIONS_TABLE_NAME is not set.");
    // This function is internal, so we might not return an HTTP error, but log it.
    // Depending on how this is used, you might throw an error or return a status.
    throw new Error("Notification table not configured.");
  }

  const timestamp = new Date().toISOString();
  const notificationId = uuidv4();

  const notificationItem = {
    id: notificationId,
    userId: userId, // The user who should receive the notification
    type: type, // e.g., 'NEW_MESSAGE', 'TASK_COMPLETED', 'FRIEND_REQUEST'
    message: message,
    details: details, // Additional context, like IDs of related items
    isRead: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const params = {
    TableName: notificationsTableName,
    Item: notificationItem,
  };

  try {
    await dynamoDb.put(params).promise();
    log.info("Notification created successfully", { notificationId, userId, type });
    return notificationItem;
  } catch (error) {
    log.error("Error creating notification", { error: error.message, stack: error.stack, userId, type });
    // Depending on requirements, you might re-throw or handle differently
    throw new Error("Could not create notification."); 
  }
};

