const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to mark notification as read", { pathParameters: event.pathParameters, body: event.body, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const notificationId = event.pathParameters?.id;
    if (!notificationId) {
      return respondWithError(400, "Notification ID is required in the path.");
    }

    const notificationsTableName = process.env.NOTIFICATIONS_TABLE_NAME;
    if (!notificationsTableName) {
      log.error("Environment variable NOTIFICATIONS_TABLE_NAME is not set.");
      return respondWithError(500, "Server configuration error.");
    }

    // First, check if the notification exists and belongs to the user
    const getParams = {
      TableName: notificationsTableName,
      Key: {
        id: notificationId,
      },
    };
    const getResult = await dynamoDb.get(getParams).promise();

    if (!getResult.Item) {
      log.warn("Notification not found for marking as read", { notificationId, userId });
      return respondWithError(404, "Notification not found.");
    }

    if (getResult.Item.userId !== userId) {
      log.warn("User attempted to mark a notification as read that does not belong to them", { notificationId, userId, ownerUserId: getResult.Item.userId });
      return respondWithError(403, "Forbidden: You do not have permission to mark this notification as read.");
    }

    // Update the notification to mark it as read
    const updateParams = {
      TableName: notificationsTableName,
      Key: {
        id: notificationId,
      },
      UpdateExpression: "SET isRead = :isRead, updatedAt = :updatedAt",
      ExpressionAttributeValues: {
        ":isRead": true,
        ":updatedAt": new Date().toISOString(),
      },
      ReturnValues: "ALL_NEW",
    };

    const updatedResult = await dynamoDb.update(updateParams).promise();
    log.info("Notification marked as read successfully", { notificationId, userId });

    return respondWithSuccess(200, updatedResult.Attributes);

  } catch (error) {
    log.error("Error marking notification as read", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not mark notification as read. Please try again later.");
  }
};

