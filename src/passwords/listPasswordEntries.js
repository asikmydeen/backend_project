const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

// KMS is NOT needed for listing as we don't decrypt passwords here.

module.exports.handler = async (event) => {
  log.info("Received request to list password entries", { queryStringParameters: event.queryStringParameters, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const passwordEntriesTableName = process.env.PASSWORD_ENTRIES_TABLE_NAME;
    // GSI on userId to query all password entries for a user
    const passwordEntriesUserIdGsiName = process.env.PASSWORD_ENTRIES_USER_ID_GSI_NAME; 

    if (!passwordEntriesTableName || !passwordEntriesUserIdGsiName) {
      log.error("Environment variables PASSWORD_ENTRIES_TABLE_NAME or PASSWORD_ENTRIES_USER_ID_GSI_NAME are not set.");
      return respondWithError(500, "Server configuration error.");
    }

    const { category, sortBy = 'serviceName', sortOrder = 'asc' } = event.queryStringParameters || {};

    let keyConditionExpression = "userId = :userId";
    const expressionAttributeValues = { ":userId": userId };
    let filterExpression = "";

    if (category) {
        filterExpression = "category = :category";
        expressionAttributeValues[":category"] = category;
    }

    const dynamoParams = {
      TableName: passwordEntriesTableName,
      IndexName: passwordEntriesUserIdGsiName, 
      KeyConditionExpression: keyConditionExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      // IMPORTANT: Do NOT project the encryptedPassword attribute in the GSI or select it here for listing.
      // If the GSI projects all attributes, we must remove it before sending to client.
      // ProjectionExpression: "id, userId, serviceName, username, url, notes, category, tags, twoFactorEnabled, customFields, createdAt, updatedAt, passwordLastChangedAt",
      ScanIndexForward: sortOrder === 'asc', // Depends on GSI sort key
    };

    if (filterExpression) {
        dynamoParams.FilterExpression = filterExpression;
    }

    const result = await dynamoDb.query(dynamoParams).promise();
    log.info("Password entries listed successfully", { userId, count: result.Items.length });

    // Remove encryptedPassword from all items before returning
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
    log.error("Error listing password entries", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not list password entries. Please try again later.");
  }
};

