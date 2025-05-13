const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to delete bookmark", { pathParameters: event.pathParameters, eventContext: event.requestContext });

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

    // First, get the bookmark to ensure it exists and belongs to the user before deleting
    const getParams = {
      TableName: bookmarksTableName,
      Key: { id: bookmarkId },
    };
    const getResult = await dynamoDb.get(getParams).promise();

    if (!getResult.Item) {
      log.warn("Bookmark not found for deletion", { bookmarkId, userId });
      return respondWithError(404, "Bookmark not found.");
    }

    if (getResult.Item.userId !== userId) {
      log.warn("User attempted to delete a bookmark they do not own", { bookmarkId, requestingUserId: userId, ownerUserId: getResult.Item.userId });
      return respondWithError(403, "Forbidden: You do not have permission to delete this bookmark.");
    }

    const deleteParams = {
      TableName: bookmarksTableName,
      Key: {
        id: bookmarkId,
      },
    };

    await dynamoDb.delete(deleteParams).promise();
    log.info("Bookmark deleted successfully", { bookmarkId, userId });

    // TODO: Consider recording this activity in the ActivitiesTable

    return respondWithSuccess(204, { message: "Bookmark deleted successfully." });

  } catch (error) {
    log.error("Error deleting bookmark", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not delete bookmark. Please try again later.");
  }
};

