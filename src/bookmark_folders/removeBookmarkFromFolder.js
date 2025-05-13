const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to remove bookmark from folder", { pathParameters: event.pathParameters, eventContext: event.requestContext });

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

    // 1. Verify the folder exists and belongs to the user (optional, but good for context)
    //    If the bookmark is simply being unassigned, folder ownership might not be strictly necessary to check here,
    //    as long as the bookmark itself is owned by the user.
    const getFolderParams = {
      TableName: bookmarkFoldersTableName,
      Key: { id: folderId },
    };
    const folderResult = await dynamoDb.get(getFolderParams).promise();
    if (!folderResult.Item || folderResult.Item.userId !== userId) {
      // This check ensures the folderId provided in the path is valid and owned by the user.
      // If the goal is just to remove a bookmark from *any* folder it might be in (identified by bookmarkId alone),
      // then this check might be too restrictive if the folderId in path is just for API clarity.
      // However, typical RESTful design implies the folderId in path is the specific folder to act upon.
      log.warn("Folder not found or user does not own it", { folderId, userId });
      return respondWithError(404, "Folder not found or access denied.");
    }

    // 2. Verify the bookmark exists, belongs to the user, and is currently in the specified folder
    const getBookmarkParams = {
      TableName: bookmarksTableName,
      Key: { id: bookmarkId },
    };
    const bookmarkResult = await dynamoDb.get(getBookmarkParams).promise();
    if (!bookmarkResult.Item || bookmarkResult.Item.userId !== userId) {
      log.warn("Bookmark not found or user does not own it", { bookmarkId, userId });
      return respondWithError(404, "Bookmark not found or access denied.");
    }

    if (bookmarkResult.Item.folderId !== folderId) {
      log.warn("Bookmark is not in the specified folder", { bookmarkId, actualFolderId: bookmarkResult.Item.folderId, specifiedFolderId: folderId });
      // Client might have stale data, or it's an attempt to remove from a folder it's not in.
      // Return a success or a specific message. For now, let's say it's not an error if the goal is achieved (it's not in the folder).
      // Or, more strictly, return an error:
      return respondWithError(400, "Bookmark is not currently in the specified folder.");
    }

    // 3. Update the bookmark's folderId to null (or use REMOVE folderId)
    const updateBookmarkParams = {
      TableName: bookmarksTableName,
      Key: { id: bookmarkId },
      UpdateExpression: "SET folderId = :nullFolderId, updatedAt = :updatedAt", 
      // Alternative: UpdateExpression: "REMOVE folderId SET updatedAt = :updatedAt",
      ExpressionAttributeValues: {
        ":nullFolderId": null, // Setting to null to orphan it
        ":updatedAt": new Date().toISOString(),
      },
      ReturnValues: "UPDATED_NEW",
    };

    const updatedBookmark = await dynamoDb.update(updateBookmarkParams).promise();
    log.info("Bookmark removed from folder successfully", { bookmarkId, folderId, userId });

    // TODO: Record activity

    return respondWithSuccess(200, { message: "Bookmark removed from folder successfully.", bookmark: updatedBookmark.Attributes });

  } catch (error) {
    log.error("Error removing bookmark from folder", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not remove bookmark from folder. Please try again later.");
  }
};

