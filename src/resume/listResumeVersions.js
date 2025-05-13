const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to list resume versions", { queryStringParameters: event.queryStringParameters, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const resumeVersionsTableName = process.env.RESUME_VERSIONS_TABLE_NAME;
    if (!resumeVersionsTableName) {
      log.error("Environment variable RESUME_VERSIONS_TABLE_NAME is not set.");
      return respondWithError(500, "Server configuration error.");
    }

    const { tag, limit, nextToken } = event.queryStringParameters || {};
    
    // Base query parameters
    const queryParams = {
      TableName: resumeVersionsTableName,
      KeyConditionExpression: "userId = :userId",
      ExpressionAttributeValues: {
        ":userId": userId,
      },
      Limit: limit ? parseInt(limit, 10) : 50,
    };

    // If tag is provided, filter by tag
    if (tag) {
      queryParams.FilterExpression = "contains(tags, :tag)";
      queryParams.ExpressionAttributeValues[":tag"] = tag;
    }

    // If nextToken is provided, use it for pagination
    if (nextToken) {
      queryParams.ExclusiveStartKey = JSON.parse(Buffer.from(nextToken, 'base64').toString());
    }

    const result = await dynamoDb.query(queryParams).promise();
    
    // Prepare the response
    const response = {
      resumeVersions: result.Items,
      count: result.Count,
    };

    // If there are more results, include the next token
    if (result.LastEvaluatedKey) {
      response.nextToken = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
    }

    log.info("Resume versions listed successfully", { userId, count: result.Count });
    return respondWithSuccess(200, response);

  } catch (error) {
    log.error("Error listing resume versions", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not list resume versions. Please try again later.");
  }
};
