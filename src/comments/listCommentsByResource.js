const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
// getUserIdFromEvent might not be strictly necessary for listing public comments, 
// but could be used for user-specific views or if comments are private.
// For now, assuming comments are public once created for a resource.
const { getUserIdFromEvent } = require("../utils/authUtils"); 

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to list comments by resource", { pathParameters: event.pathParameters, queryStringParameters: event.queryStringParameters, eventContext: event.requestContext });

  try {
    // Optional: Validate user token if comments have privacy settings tied to users.
    // const userId = getUserIdFromEvent(event);
    // if (!userId) {
    //   return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    // }

    const resourceId = event.pathParameters?.resourceId;
    if (!resourceId) {
      return respondWithError(400, "Resource ID is required in the path to list comments.");
    }

    const { sortBy = 'createdAt', sortOrder = 'desc', limit, lastEvaluatedKey } = event.queryStringParameters || {};
    const parsedLimit = limit ? parseInt(limit, 10) : 20; // Default limit

    const commentsTableName = process.env.COMMENTS_TABLE_NAME;
    // GSI: CommentsByResourceIndex (resourceId as PK, createdAt as SK for sorting)
    const commentsByResourceIndexName = process.env.COMMENTS_BY_RESOURCE_INDEX_NAME;

    if (!commentsTableName || !commentsByResourceIndexName) {
      log.error("Environment variables COMMENTS_TABLE_NAME or COMMENTS_BY_RESOURCE_INDEX_NAME are not set.");
      return respondWithError(500, "Server configuration error.");
    }

    const dynamoParams = {
      TableName: commentsTableName,
      IndexName: commentsByResourceIndexName,
      KeyConditionExpression: "resourceId = :resourceId",
      ExpressionAttributeValues: { ":resourceId": resourceId },
      ScanIndexForward: sortOrder === 'asc', // 'desc' for newest first, 'asc' for oldest first
      Limit: parsedLimit,
    };

    if (lastEvaluatedKey) {
        try {
            dynamoParams.ExclusiveStartKey = JSON.parse(Buffer.from(lastEvaluatedKey, 'base64').toString('utf8'));
        } catch (e) {
            log.warn("Invalid lastEvaluatedKey format", { lastEvaluatedKey });
            return respondWithError(400, "Invalid pagination token (lastEvaluatedKey).");
        }
    }
    
    // Note: DynamoDB sort order on GSI is defined at GSI creation or by ScanIndexForward.
    // If GSI sort key is `createdAt`, ScanIndexForward controls the order.
    // If `sortBy` is different from GSI sort key, client-side or Lambda-side sorting would be needed after fetching.
    // For simplicity, we assume GSI is `resourceId` (PK) and `createdAt` (SK).

    const result = await dynamoDb.query(dynamoParams).promise();
    log.info(`Comments listed for resource ${resourceId} successfully`, { count: result.Items.length });

    const response = {
        items: result.Items,
    };

    if (result.LastEvaluatedKey) {
        response.lastEvaluatedKey = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
    }

    return respondWithSuccess(200, response);

  } catch (error) {
    log.error("Error listing comments by resource", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not list comments. Please try again later.");
  }
};

