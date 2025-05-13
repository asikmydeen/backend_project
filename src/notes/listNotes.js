const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to list notes", { queryStringParameters: event.queryStringParameters, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const notesTableName = process.env.NOTES_TABLE_NAME;
    const notesUserIdGsiName = process.env.NOTES_USER_ID_GSI_NAME; // e.g., "UserIdCreatedAtGSI"

    if (!notesTableName || !notesUserIdGsiName) {
      log.error("Environment variables NOTES_TABLE_NAME or NOTES_USER_ID_GSI_NAME are not set.");
      return respondWithError(500, "Server configuration error.");
    }

    // Basic query by userId, can be extended with filters from queryStringParameters
    // e.g., ?isArchived=false&isPinned=true&category=work
    const { isArchived, isPinned, category, sortBy = 'updatedAt', sortOrder = 'desc' } = event.queryStringParameters || {};

    let keyConditionExpression = "userId = :userId";
    const expressionAttributeValues = { ":userId": userId };
    const filterExpressionParts = [];

    if (isArchived !== undefined) {
        filterExpressionParts.push("isArchived = :isArchived");
        expressionAttributeValues[":isArchived"] = (isArchived === 'true');
    }
    if (isPinned !== undefined) {
        filterExpressionParts.push("isPinned = :isPinned");
        expressionAttributeValues[":isPinned"] = (isPinned === 'true');
    }
    if (category) {
        filterExpressionParts.push("category = :category");
        expressionAttributeValues[":category"] = category;
    }

    const dynamoParams = {
      TableName: notesTableName,
      IndexName: notesUserIdGsiName, // Querying on the GSI for userId
      KeyConditionExpression: keyConditionExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ScanIndexForward: sortOrder === 'asc', // Sort order for GSI sort key (e.g., createdAt or updatedAt)
      // Add Limit and ExclusiveStartKey for pagination if needed
    };

    if (filterExpressionParts.length > 0) {
        dynamoParams.FilterExpression = filterExpressionParts.join(" AND ");
    }
    
    // Note: The GSI should be on userId (Partition Key) and a sortable attribute like 'updatedAt' or 'createdAt' (Sort Key)
    // If NOTES_USER_ID_GSI_NAME is just on 'userId', then sorting needs to happen post-query or use a different GSI.
    // For simplicity, assuming GSI is `userId-updatedAt-index` or `userId-createdAt-index` for sorting.
    // If not, results will be sorted by primary key of the GSI, then client-side or further Lambda processing for sort.

    const result = await dynamoDb.query(dynamoParams).promise();
    log.info("Notes listed successfully", { userId, count: result.Items.length });

    // If GSI doesn't directly support the sortBy field, sort here (less efficient for large datasets)
    let items = result.Items;
    if (sortBy && (sortBy === 'updatedAt' || sortBy === 'createdAt' || sortBy === 'title')) {
        items.sort((a, b) => {
            if (a[sortBy] < b[sortBy]) return sortOrder === 'asc' ? -1 : 1;
            if (a[sortBy] > b[sortBy]) return sortOrder === 'asc' ? 1 : -1;
            return 0;
        });
    }

    return respondWithSuccess(200, items);

  } catch (error) {
    log.error("Error listing notes", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not list notes. Please try again later.");
  }
};

