const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to list photos", { queryStringParameters: event.queryStringParameters, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const photosTableName = process.env.PHOTOS_TABLE_NAME;
    if (!photosTableName) {
      log.error("Environment variable PHOTOS_TABLE_NAME is not set.");
      return respondWithError(500, "Server configuration error.");
    }

    const { albumId, tag, limit, nextToken } = event.queryStringParameters || {};
    
    // Base query parameters
    const queryParams = {
      TableName: photosTableName,
      KeyConditionExpression: "userId = :userId",
      ExpressionAttributeValues: {
        ":userId": userId,
      },
      Limit: limit ? parseInt(limit, 10) : 50,
    };

    // If albumId is provided, filter by albumId
    if (albumId) {
      queryParams.FilterExpression = "albumId = :albumId";
      queryParams.ExpressionAttributeValues[":albumId"] = albumId;
    }

    // If tag is provided, filter by tag
    if (tag) {
      queryParams.FilterExpression = queryParams.FilterExpression 
        ? `${queryParams.FilterExpression} AND contains(tags, :tag)` 
        : "contains(tags, :tag)";
      queryParams.ExpressionAttributeValues[":tag"] = tag;
    }

    // If nextToken is provided, use it for pagination
    if (nextToken) {
      queryParams.ExclusiveStartKey = JSON.parse(Buffer.from(nextToken, 'base64').toString());
    }

    const result = await dynamoDb.query(queryParams).promise();
    
    // Prepare the response
    const response = {
      photos: result.Items,
      count: result.Count,
    };

    // If there are more results, include the next token
    if (result.LastEvaluatedKey) {
      response.nextToken = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
    }

    log.info("Photos listed successfully", { userId, count: result.Count });
    return respondWithSuccess(200, response);

  } catch (error) {
    log.error("Error listing photos", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not list photos. Please try again later.");
  }
};
