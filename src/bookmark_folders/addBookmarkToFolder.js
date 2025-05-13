const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to add bookmark to folder", { pathParameters: event.pathParameters, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const { folderId, bookmarkId } = event.pathParameters;
    if (!folderId || !bookmarkId) {
      return respondWithError(400, "Folder ID and Bookmark ID are required in the path.");
    }

    const bookmarksTableName = process.env.BOOKMARKS_TABLE_NAME;
    const bookmarkFoldersTableName = process.env.BOOKMARK_FOLDERS_TABLE_NAME;

    if (!bookmarksTableName || !bookmarkFoldersTableName) {
      log.error("Environment variables for table names are not set.");
      return respondWithError(500, "Server configuration error.");
    }

    // 1. Verify the folder exists and belongs to the user
    const getFolderParams = {
      TableName: bookmarkFoldersTableName,
      Key: { id: folderId },
    };
    const folderResult = await dynamoDb.get(getFolderParams).promise();
    if (!folderResult.Item || folderResult.Item.userId !== userId) {
      log.warn("Folder not found or user does not own it", { folderId, userId });
      return respondWithError(404, "Folder not found or access denied.");
    }

    // 2. Verify the bookmark exists and belongs to the user
    const getBookmarkParams = {
      TableName: bookmarksTableName,
      Key: { id: bookmarkId },
    };
    const bookmarkResult = await dynamoDb.get(getBookmarkParams).promise();
    if (!bookmarkResult.Item || bookmarkResult.Item.userId !== userId) {
      log.warn("Bookmark not found or user does not own it", { bookmarkId, userId });
      return respondWithError(404, "Bookmark not found or access denied.");
    }

    // 3. Update the bookmark's folderId
    const updateBookmarkParams = {
      TableName: bookmarksTableName,
      Key: { id: bookmarkId },
      UpdateExpression: "SET folderId = :folderId, updatedAt = :updatedAt",
      ExpressionAttributeValues: {
        ":folderId": folderId,
        ":updatedAt": new Date().toISOString(),
      },
      ReturnValues: "UPDATED_NEW",
    };

    const updatedBookmark = await dynamoDb.update(updateBookmarkParams).promise();
    log.info("Bookmark added to folder successfully", { bookmarkId, folderId, userId });

    // TODO: Record activity

    return respondWithSuccess(200, { message: "Bookmark added to folder successfully.", bookmark: updatedBookmark.Attributes });

  } catch (error) {
    log.error("Error adding bookmark to folder", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not add bookmark to folder. Please try again later.");
  }
};

