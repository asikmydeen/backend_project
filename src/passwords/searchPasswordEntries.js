const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

// KMS is NOT needed for search as we don't decrypt passwords here.

module.exports.handler = async (event) => {
  log.info("Received request to search password entries", { queryStringParameters: event.queryStringParameters, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const { q, category, sortBy = 'serviceName', sortOrder = 'asc' } = event.queryStringParameters || {};

    if (!q && !category) {
      // If no search query or category, this could default to listPasswordEntries or return an error/empty set.
      // For now, let's require at least 'q' for a search.
      // Or, if q is empty but category is present, it becomes listPasswordEntriesByCategory.
      // The API plan implies /search?q= is the primary route, so q should be present.
      return respondWithError(400, "Search query 'q' is required for searching password entries.");
    }

    const passwordEntriesTableName = process.env.PASSWORD_ENTRIES_TABLE_NAME;
    // GSI on userId to query all password entries for a user
    const passwordEntriesUserIdGsiName = process.env.PASSWORD_ENTRIES_USER_ID_GSI_NAME;

    if (!passwordEntriesTableName || !passwordEntriesUserIdGsiName) {
      log.error("Environment variables PASSWORD_ENTRIES_TABLE_NAME or PASSWORD_ENTRIES_USER_ID_GSI_NAME are not set.");
      return respondWithError(500, "Server configuration error.");
    }

    // Base query for the user's entries
    const dynamoParams = {
      TableName: passwordEntriesTableName,
      IndexName: passwordEntriesUserIdGsiName,
      KeyConditionExpression: "userId = :userId",
      ExpressionAttributeValues: { ":userId": userId },
      // ProjectionExpression to exclude encryptedPassword
      ProjectionExpression: "id, userId, serviceName, username, url, notes, category, tags, twoFactorEnabled, customFields, createdAt, updatedAt, passwordLastChangedAt",
      ScanIndexForward: sortOrder === 'asc',
    };

    // Build FilterExpression for search query 'q' and 'category'
    let filterExpressions = [];
    if (q) {
      const searchQuery = q.toLowerCase();
      // Search across serviceName, username, url, notes, tags (if tags is an array of strings)
      // For tags, it's more complex if it's an array; CONTAINS might not work directly on list elements in a filter for GSI query.
      // A simpler approach is to fetch and filter in Lambda, or denormalize tags into a searchable string.
      // For now, let's focus on string fields.
      filterExpressions.push(
        "(contains(serviceName, :q) OR contains(username, :q) OR contains(url, :q) OR contains(notes, :q) OR contains(category, :q))"
      );
      dynamoParams.ExpressionAttributeValues[":q"] = searchQuery;
    }

    if (category) {
      filterExpressions.push("category = :categoryVal");
      dynamoParams.ExpressionAttributeValues[":categoryVal"] = category;
    }

    if (filterExpressions.length > 0) {
      dynamoParams.FilterExpression = filterExpressions.join(" AND ");
    }
    
    // If only category is provided and q is empty, this effectively becomes listPasswordEntriesByCategory
    // but the route is /search, so 'q' is expected. If q is truly optional on this route, logic needs adjustment.
    // Based on `GET /api/v1/passwords/search?q=`, 'q' is the main parameter.

    const result = await dynamoDb.query(dynamoParams).promise();
    log.info("Password entries search completed", { userId, query: q, category, count: result.Items.length });

    let itemsToReturn = result.Items.map(item => {
      const { encryptedPassword, ...rest } = item; // Ensure encryptedPassword is not returned
      return rest;
    });

    // Sorting if GSI doesn't directly support it or for additional fields
    if (sortBy && (sortBy === 'serviceName' || sortBy === 'username' || sortBy === 'updatedAt' || sortBy === 'createdAt')) {
        itemsToReturn.sort((a, b) => {
            const valA = a[sortBy] ? (typeof a[sortBy] === 'string' ? a[sortBy].toLowerCase() : a[sortBy]) : '';
            const valB = b[sortBy] ? (typeof b[sortBy] === 'string' ? b[sortBy].toLowerCase() : b[sortBy]) : '';
            if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
            if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
            return 0;
        });
    }

    return respondWithSuccess(200, itemsToReturn);

  } catch (error) {
    log.error("Error searching password entries", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not search password entries. Please try again later.");
  }
};

