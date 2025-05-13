const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to list activities", { queryStringParameters: event.queryStringParameters, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const { limit, lastEvaluatedKey, activityType, resourceType, resourceId, dateFrom, dateTo } = event.queryStringParameters || {};
    const parsedLimit = limit ? parseInt(limit, 10) : 20; // Default limit

    const activitiesTableName = process.env.ACTIVITIES_TABLE_NAME;
    // GSI: ActivitiesByUserIndex (userId as PK, timestamp as SK for sorting)
    const activitiesByUserIndexName = process.env.ACTIVITIES_BY_USER_INDEX_NAME;

    if (!activitiesTableName || !activitiesByUserIndexName) {
      log.error("Environment variables ACTIVITIES_TABLE_NAME or ACTIVITIES_BY_USER_INDEX_NAME are not set.");
      return respondWithError(500, "Server configuration error.");
    }

    const dynamoParams = {
      TableName: activitiesTableName,
      IndexName: activitiesByUserIndexName,
      KeyConditionExpression: "userId = :userId",
      ExpressionAttributeValues: { ":userId": userId },
      ScanIndexForward: false, // Newest first by default (timestamp DESC)
      Limit: parsedLimit,
    };

    let filterExpressions = [];
    if (activityType) {
      filterExpressions.push("activityType = :activityType");
      dynamoParams.ExpressionAttributeValues[":activityType"] = activityType;
    }
    if (resourceType) {
      filterExpressions.push("details.resourceType = :resourceType"); // Assuming resourceType is in details
      dynamoParams.ExpressionAttributeValues[":resourceType"] = resourceType;
    }
    if (resourceId) {
      filterExpressions.push("details.resourceId = :resourceId"); // Assuming resourceId is in details
      dynamoParams.ExpressionAttributeValues[":resourceId"] = resourceId;
    }
    if (dateFrom) {
      filterExpressions.push("createdAt >= :dateFrom");
      dynamoParams.ExpressionAttributeValues[":dateFrom"] = dateFrom;
    }
    if (dateTo) {
      filterExpressions.push("createdAt <= :dateTo");
      dynamoParams.ExpressionAttributeValues[":dateTo"] = dateTo;
    }

    if (filterExpressions.length > 0) {
      dynamoParams.FilterExpression = filterExpressions.join(" AND ");
    }

    if (lastEvaluatedKey) {
        try {
            dynamoParams.ExclusiveStartKey = JSON.parse(Buffer.from(lastEvaluatedKey, 'base64').toString('utf8'));
        } catch (e) {
            log.warn("Invalid lastEvaluatedKey format for activities", { lastEvaluatedKey });
            return respondWithError(400, "Invalid pagination token (lastEvaluatedKey).");
        }
    }

    const result = await dynamoDb.query(dynamoParams).promise();
    log.info(`Activities listed for user ${userId} successfully`, { count: result.Items.length, filters: { activityType, resourceType, resourceId, dateFrom, dateTo } });

    const response = {
        items: result.Items,
    };

    if (result.LastEvaluatedKey) {
        response.lastEvaluatedKey = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
    }

    return respondWithSuccess(200, response);

  } catch (error) {
    log.error("Error listing activities", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not list activities. Please try again later.");
  }
};

