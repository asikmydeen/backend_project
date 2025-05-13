const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to list bookmark folders", { queryStringParameters: event.queryStringParameters, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const bookmarkFoldersTableName = process.env.BOOKMARK_FOLDERS_TABLE_NAME;
    // GSI on userId to query all folders for a user, potentially with parentFolderId as sort key or filter
    const bookmarkFoldersUserIdGsiName = process.env.BOOKMARK_FOLDERS_USER_ID_GSI_NAME; 

    if (!bookmarkFoldersTableName || !bookmarkFoldersUserIdGsiName) {
      log.error("Environment variables BOOKMARK_FOLDERS_TABLE_NAME or BOOKMARK_FOLDERS_USER_ID_GSI_NAME are not set.");
      return respondWithError(500, "Server configuration error.");
    }

    const { parentFolderId, sortBy = 'name', sortOrder = 'asc' } = event.queryStringParameters || {};

    let keyConditionExpression = "userId = :userId";
    const expressionAttributeValues = { ":userId": userId };
    let filterExpression = "";

    // If parentFolderId is provided, filter by it. 
    // If parentFolderId is 'null' (string), query for root folders.
    // If parentFolderId is not provided, list all folders for the user (can be many).
    if (parentFolderId !== undefined) {
        if (parentFolderId.toLowerCase() === 'null') {
            // Filter for items where parentFolderId is null or does not exist (root folders)
            filterExpression = "attribute_not_exists(parentFolderId) OR parentFolderId = :parentFolderIdNull";
            expressionAttributeValues[":parentFolderIdNull"] = null;
        } else {
            filterExpression = "parentFolderId = :parentFolderId";
            expressionAttributeValues[":parentFolderId"] = parentFolderId;
        }
    }

    const dynamoParams = {
      TableName: bookmarkFoldersTableName,
      IndexName: bookmarkFoldersUserIdGsiName, 
      KeyConditionExpression: keyConditionExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ScanIndexForward: sortOrder === 'asc', // This depends on the GSI's sort key
    };

    if (filterExpression) {
        dynamoParams.FilterExpression = filterExpression;
    }

    const result = await dynamoDb.query(dynamoParams).promise();
    log.info("Bookmark folders listed successfully", { userId, count: result.Items.length });

    let items = result.Items;
    // Sorting if GSI doesn't directly support it or for additional fields
    if (sortBy && (sortBy === 'name' || sortBy === 'createdAt' || sortBy === 'updatedAt')) {
        items.sort((a, b) => {
            const valA = a[sortBy] ? (typeof a[sortBy] === 'string' ? a[sortBy].toLowerCase() : a[sortBy]) : '';
            const valB = b[sortBy] ? (typeof b[sortBy] === 'string' ? b[sortBy].toLowerCase() : b[sortBy]) : '';
            if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
            if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
            return 0;
        });
    }

    return respondWithSuccess(200, items);

  } catch (error) {
    log.error("Error listing bookmark folders", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not list bookmark folders. Please try again later.");
  }
};

