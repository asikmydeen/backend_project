const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to get bookmark folder", { pathParameters: event.pathParameters, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const folderId = event.pathParameters?.id;
    if (!folderId) {
      return respondWithError(400, "Folder ID is required in the path.");
    }

    const bookmarkFoldersTableName = process.env.BOOKMARK_FOLDERS_TABLE_NAME;
    if (!bookmarkFoldersTableName) {
      log.error("Environment variable BOOKMARK_FOLDERS_TABLE_NAME is not set.");
      return respondWithError(500, "Server configuration error.");
    }

    const dynamoParams = {
      TableName: bookmarkFoldersTableName,
      Key: {
        id: folderId,
      },
    };

    const result = await dynamoDb.get(dynamoParams).promise();

    if (!result.Item) {
      log.warn("Bookmark folder not found", { folderId, userId });
      return respondWithError(404, "Bookmark folder not found.");
    }

    // Verify that the folder belongs to the requesting user
    if (result.Item.userId !== userId) {
      log.warn("User attempted to access a bookmark folder they do not own", { folderId, requestingUserId: userId, ownerUserId: result.Item.userId });
      return respondWithError(403, "Forbidden: You do not have permission to access this folder.");
    }

    log.info("Bookmark folder retrieved successfully", { folderId, userId });
    return respondWithSuccess(200, result.Item);

  } catch (error) {
    log.error("Error getting bookmark folder", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not retrieve bookmark folder. Please try again later.");
  }
};

