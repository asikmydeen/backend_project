const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to list bookmarks in folder", { pathParameters: event.pathParameters, queryStringParameters: event.queryStringParameters, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const { folderId } = event.pathParameters;
    if (!folderId) {
      return respondWithError(400, "Folder ID is required in the path.");
    }

    const bookmarksTableName = process.env.BOOKMARKS_TABLE_NAME;
    const bookmarkFoldersTableName = process.env.BOOKMARK_FOLDERS_TABLE_NAME;
    // This GSI on the Bookmarks table should be on `folderId` (Partition Key) and optionally `userId` (Sort Key) or `userId` as part of a composite PK.
    // Or, more simply, a GSI on `folderId` and then filter by `userId` if `userId` is not part of the GSI key.
    // Let's assume a GSI: BOOKMARKS_FOLDER_ID_USER_ID_GSI_NAME on BookmarksTable with folderId (PK) and userId (SK)
    // Or a GSI: BOOKMARKS_FOLDER_ID_GSI_NAME on BookmarksTable with folderId (PK), then filter by userId.
    const bookmarksFolderIdGsiName = process.env.BOOKMARKS_FOLDER_ID_GSI_NAME; // e.g., "FolderIdIndex" or "FolderIdUserIdIndex"

    if (!bookmarksTableName || !bookmarkFoldersTableName || !bookmarksFolderIdGsiName) {
      log.error("Environment variables for table names or GSI names are not set.");
      return respondWithError(500, "Server configuration error.");
    }

    // 1. Verify the folder exists and belongs to the user
    const getFolderParams = {
      TableName: bookmarkFoldersTableName,
      Key: { id: folderId },
    };
    const folderResult = await dynamoDb.get(getFolderParams).promise();
    if (!folderResult.Item || folderResult.Item.userId !== userId) {
      log.warn("Folder not found or user does not own it when listing bookmarks", { folderId, userId });
      return respondWithError(404, "Folder not found or access denied.");
    }

    // 2. Query bookmarks by folderId using the GSI
    const { sortBy = 'title', sortOrder = 'asc' } = event.queryStringParameters || {};

    const listBookmarksParams = {
      TableName: bookmarksTableName,
      IndexName: bookmarksFolderIdGsiName, 
      KeyConditionExpression: "folderId = :folderId",
      // If userId is not part of GSI key, add it to FilterExpression
      // FilterExpression: "userId = :userId", 
      // ExpressionAttributeValues: { ":folderId": folderId, ":userId": userId },
      ExpressionAttributeValues: { ":folderId": folderId },
      // ScanIndexForward for sorting if GSI sort key allows, otherwise sort in Lambda
    };
    
    // If your GSI is only on folderId, you MUST filter by userId to ensure security and correctness.
    // Assuming the GSI `bookmarksFolderIdGsiName` might not have userId as a sort key, we add a filter.
    // If the GSI *does* have userId (e.g. folderId as PK, userId as SK), then KeyConditionExpression would be "folderId = :folderId AND userId = :userId"
    // For this example, let's assume a GSI on folderId and we filter by userId.
    listBookmarksParams.FilterExpression = "userId = :currentUserId";
    listBookmarksParams.ExpressionAttributeValues[":currentUserId"] = userId;


    const result = await dynamoDb.query(listBookmarksParams).promise();
    log.info(`Bookmarks listed for folder ${folderId} successfully`, { userId, count: result.Items.length });

    let items = result.Items;
    if (sortBy && (sortBy === 'updatedAt' || sortBy === 'createdAt' || sortBy === 'title' || sortBy === 'url')) {
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
    log.error("Error listing bookmarks in folder", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not list bookmarks in folder. Please try again later.");
  }
};

