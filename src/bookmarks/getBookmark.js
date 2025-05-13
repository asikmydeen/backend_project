const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to get bookmark", { pathParameters: event.pathParameters, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const bookmarkId = event.pathParameters?.id;
    if (!bookmarkId) {
      return respondWithError(400, "Bookmark ID is required in the path.");
    }

    const bookmarksTableName = process.env.BOOKMARKS_TABLE_NAME;
    if (!bookmarksTableName) {
      log.error("Environment variable BOOKMARKS_TABLE_NAME is not set.");
      return respondWithError(500, "Server configuration error.");
    }

    const dynamoParams = {
      TableName: bookmarksTableName,
      Key: {
        id: bookmarkId,
      },
    };

    const result = await dynamoDb.get(dynamoParams).promise();

    if (!result.Item) {
      log.warn("Bookmark not found", { bookmarkId, userId });
      return respondWithError(404, "Bookmark not found.");
    }

    // Verify that the bookmark belongs to the requesting user
    if (result.Item.userId !== userId) {
      log.warn("User attempted to access a bookmark they do not own", { bookmarkId, requestingUserId: userId, ownerUserId: result.Item.userId });
      return respondWithError(403, "Forbidden: You do not have permission to access this bookmark.");
    }

    log.info("Bookmark retrieved successfully", { bookmarkId, userId });
    return respondWithSuccess(200, result.Item);

  } catch (error) {
    log.error("Error getting bookmark", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not retrieve bookmark. Please try again later.");
  }
};

