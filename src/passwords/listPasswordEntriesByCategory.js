const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

// KMS is NOT needed for listing by category as we don't decrypt passwords here.

module.exports.handler = async (event) => {
  log.info("Received request to list password entries by category", { pathParameters: event.pathParameters, queryStringParameters: event.queryStringParameters, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const category = event.pathParameters?.category;
    if (!category) {
      return respondWithError(400, "Category is required in the path.");
    }

    const { sortBy = 'serviceName', sortOrder = 'asc' } = event.queryStringParameters || {};

    const passwordEntriesTableName = process.env.PASSWORD_ENTRIES_TABLE_NAME;
    // This GSI should be on `userId` (Partition Key) and `category` (Sort Key) for efficient querying.
    // Or, a GSI on `category` (PK) and `userId` (SK) if you expect to query across users for a category (less likely for this app).
    // Let's assume a GSI: PASSWORD_ENTRIES_USER_ID_CATEGORY_GSI_NAME on PasswordEntriesTable with userId (PK) and category (SK).
    // If the GSI is on `category` as PK and `userId` as SK, the query changes.
    // For this example, let's use a GSI where `userId` is the PK and `category` is a filterable attribute or part of a composite sort key.
    // A more optimal GSI for this specific query would be `userId` (PK) and `category` (SK) or `category` (PK) and `userId` (SK).
    // Let's assume a GSI `PasswordEntriesCategoryIndex` with `category` as PK and `userId` or `serviceName` as SK.
    // Or, if using the existing `PASSWORD_ENTRIES_USER_ID_GSI_NAME`, we filter by category.
    const passwordEntriesUserIdGsiName = process.env.PASSWORD_ENTRIES_USER_ID_GSI_NAME; // GSI on userId
    // An alternative GSI could be PASSWORD_ENTRIES_CATEGORY_USER_ID_GSI_NAME with category (PK) and userId (SK)

    if (!passwordEntriesTableName || !passwordEntriesUserIdGsiName) {
      log.error("Environment variables for table name or GSI name are not set.");
      return respondWithError(500, "Server configuration error.");
    }

    const dynamoParams = {
      TableName: passwordEntriesTableName,
      IndexName: passwordEntriesUserIdGsiName, // Querying by userId first
      KeyConditionExpression: "userId = :userId",
      FilterExpression: "category = :categoryVal",
      ExpressionAttributeValues: {
        ":userId": userId,
        ":categoryVal": category,
      },
      // ProjectionExpression to exclude encryptedPassword
      ProjectionExpression: "id, userId, serviceName, username, url, notes, category, tags, twoFactorEnabled, customFields, createdAt, updatedAt, passwordLastChangedAt",
      ScanIndexForward: sortOrder === 'asc',
    };

    const result = await dynamoDb.query(dynamoParams).promise();
    log.info(`Password entries listed for category '${category}' successfully`, { userId, count: result.Items.length });

    const itemsToReturn = result.Items.map(item => {
      const { encryptedPassword, ...rest } = item;
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
    log.error("Error listing password entries by category", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not list password entries by category. Please try again later.");
  }
};

