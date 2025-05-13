const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to list share links", { queryStringParameters: event.queryStringParameters, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const shareLinksTableName = process.env.SHARE_LINKS_TABLE_NAME;
    if (!shareLinksTableName) {
      log.error("Environment variable SHARE_LINKS_TABLE_NAME is not set.");
      return respondWithError(500, "Server configuration error.");
    }

    const { resourceType, resourceId, limit, nextToken } = event.queryStringParameters || {};
    
    // Base query parameters
    const queryParams = {
      TableName: shareLinksTableName,
      KeyConditionExpression: "userId = :userId",
      ExpressionAttributeValues: {
        ":userId": userId,
      },
      Limit: limit ? parseInt(limit, 10) : 50,
    };

    // If resourceType is provided, filter by resourceType
    if (resourceType) {
      queryParams.FilterExpression = "resourceType = :resourceType";
      queryParams.ExpressionAttributeValues[":resourceType"] = resourceType;
    }

    // If resourceId is provided, filter by resourceId
    if (resourceId) {
      queryParams.FilterExpression = queryParams.FilterExpression 
        ? `${queryParams.FilterExpression} AND resourceId = :resourceId` 
        : "resourceId = :resourceId";
      queryParams.ExpressionAttributeValues[":resourceId"] = resourceId;
    }

    // If nextToken is provided, use it for pagination
    if (nextToken) {
      queryParams.ExclusiveStartKey = JSON.parse(Buffer.from(nextToken, 'base64').toString());
    }

    const result = await dynamoDb.query(queryParams).promise();
    
    // Prepare the response
    const response = {
      shareLinks: result.Items,
      count: result.Count,
    };

    // If there are more results, include the next token
    if (result.LastEvaluatedKey) {
      response.nextToken = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
    }

    log.info("Share links listed successfully", { userId, count: result.Count });
    return respondWithSuccess(200, response);

  } catch (error) {
    log.error("Error listing share links", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not list share links. Please try again later.");
  }
};
