const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to list folders", { queryStringParameters: event.queryStringParameters, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const foldersTableName = process.env.FOLDERS_TABLE_NAME;
    if (!foldersTableName) {
      log.error("Environment variable FOLDERS_TABLE_NAME is not set.");
      return respondWithError(500, "Server configuration error.");
    }

    const { parentFolderId, limit, nextToken } = event.queryStringParameters || {};
    
    // Base query parameters
    const queryParams = {
      TableName: foldersTableName,
      KeyConditionExpression: "userId = :userId",
      ExpressionAttributeValues: {
        ":userId": userId,
      },
      Limit: limit ? parseInt(limit, 10) : 50,
    };

    // If parentFolderId is provided, filter by parentFolderId
    if (parentFolderId !== undefined) {
      queryParams.FilterExpression = "parentFolderId = :parentFolderId";
      queryParams.ExpressionAttributeValues[":parentFolderId"] = parentFolderId || null;
    }

    // If nextToken is provided, use it for pagination
    if (nextToken) {
      queryParams.ExclusiveStartKey = JSON.parse(Buffer.from(nextToken, 'base64').toString());
    }

    const result = await dynamoDb.query(queryParams).promise();
    
    // Prepare the response
    const response = {
      folders: result.Items,
      count: result.Count,
    };

    // If there are more results, include the next token
    if (result.LastEvaluatedKey) {
      response.nextToken = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
    }

    log.info("Folders listed successfully", { userId, count: result.Count });
    return respondWithSuccess(200, response);

  } catch (error) {
    log.error("Error listing folders", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not list folders. Please try again later.");
  }
};
