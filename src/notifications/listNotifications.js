const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to list notifications", { queryStringParameters: event.queryStringParameters, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const { status, limit, lastEvaluatedKey } = event.queryStringParameters || {}; // status can be 'read', 'unread', or 'all'
    const parsedLimit = limit ? parseInt(limit, 10) : 20; // Default limit

    const notificationsTableName = process.env.NOTIFICATIONS_TABLE_NAME;
    // GSI: NotificationsByUserIndex (userId as PK, createdAt as SK for sorting)
    const notificationsByUserIndexName = process.env.NOTIFICATIONS_BY_USER_INDEX_NAME;

    if (!notificationsTableName || !notificationsByUserIndexName) {
      log.error("Environment variables NOTIFICATIONS_TABLE_NAME or NOTIFICATIONS_BY_USER_INDEX_NAME are not set.");
      return respondWithError(500, "Server configuration error.");
    }

    const dynamoParams = {
      TableName: notificationsTableName,
      IndexName: notificationsByUserIndexName,
      KeyConditionExpression: "userId = :userId",
      ExpressionAttributeValues: { ":userId": userId },
      ScanIndexForward: false, // Newest first by default (createdAt DESC)
      Limit: parsedLimit,
    };

    if (status && (status.toLowerCase() === 'read' || status.toLowerCase() === 'unread')) {
      dynamoParams.FilterExpression = "isRead = :isReadStatus";
      dynamoParams.ExpressionAttributeValues[":isReadStatus"] = (status.toLowerCase() === 'read');
    }

    if (lastEvaluatedKey) {
        try {
            dynamoParams.ExclusiveStartKey = JSON.parse(Buffer.from(lastEvaluatedKey, 'base64').toString('utf8'));
        } catch (e) {
            log.warn("Invalid lastEvaluatedKey format for notifications", { lastEvaluatedKey });
            return respondWithError(400, "Invalid pagination token (lastEvaluatedKey).");
        }
    }

    const result = await dynamoDb.query(dynamoParams).promise();
    log.info(`Notifications listed for user ${userId} successfully`, { count: result.Items.length, statusFilter: status });

    const response = {
        items: result.Items,
    };

    if (result.LastEvaluatedKey) {
        response.lastEvaluatedKey = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
    }

    return respondWithSuccess(200, response);

  } catch (error) {
    log.error("Error listing notifications", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not list notifications. Please try again later.");
  }
};

