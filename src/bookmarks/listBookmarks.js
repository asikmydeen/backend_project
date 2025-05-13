const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to list bookmarks", { queryStringParameters: event.queryStringParameters, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const bookmarksTableName = process.env.BOOKMARKS_TABLE_NAME;
    const bookmarksUserIdGsiName = process.env.BOOKMARKS_USER_ID_GSI_NAME; // e.g., "UserIdCreatedAtGSI"

    if (!bookmarksTableName || !bookmarksUserIdGsiName) {
      log.error("Environment variables BOOKMARKS_TABLE_NAME or BOOKMARKS_USER_ID_GSI_NAME are not set.");
      return respondWithError(500, "Server configuration error.");
    }

    const { category, folderId, sortBy = 'updatedAt', sortOrder = 'desc' } = event.queryStringParameters || {};

    let keyConditionExpression = "userId = :userId";
    const expressionAttributeValues = { ":userId": userId };
    const filterExpressionParts = [];

    if (category) {
        filterExpressionParts.push("category = :category");
        expressionAttributeValues[":category"] = category;
    }
    if (folderId) {
        filterExpressionParts.push("folderId = :folderId");
        expressionAttributeValues[":folderId"] = folderId;
    } else {
        // Default to listing bookmarks not in any folder if folderId is not specified
        // This might require folderId to be explicitly null or not exist for root bookmarks
        // For simplicity, if folderId is not passed, we don't filter by it, meaning all user's bookmarks are candidates.
        // If you want to list ONLY root bookmarks, you'd add: filterExpressionParts.push("attribute_not_exists(folderId) OR folderId = :nullFolderId"); expressionAttributeValues[":nullFolderId"] = null;
    }

    const dynamoParams = {
      TableName: bookmarksTableName,
      IndexName: bookmarksUserIdGsiName, // Querying on the GSI for userId
      KeyConditionExpression: keyConditionExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ScanIndexForward: sortOrder === 'asc',
    };

    if (filterExpressionParts.length > 0) {
        dynamoParams.FilterExpression = filterExpressionParts.join(" AND ");
    }

    const result = await dynamoDb.query(dynamoParams).promise();
    log.info("Bookmarks listed successfully", { userId, count: result.Items.length });

    let items = result.Items;
    if (sortBy && (sortBy === 'updatedAt' || sortBy === 'createdAt' || sortBy === 'title' || sortBy === 'url')) {
        items.sort((a, b) => {
            const valA = a[sortBy] ? a[sortBy].toLowerCase() : ''; // Handle undefined and case for strings
            const valB = b[sortBy] ? b[sortBy].toLowerCase() : '';
            if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
            if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
            return 0;
        });
    }

    return respondWithSuccess(200, items);

  } catch (error) {
    log.error("Error listing bookmarks", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not list bookmarks. Please try again later.");
  }
};

