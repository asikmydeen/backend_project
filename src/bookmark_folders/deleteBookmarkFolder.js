const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to delete bookmark folder", { pathParameters: event.pathParameters, eventContext: event.requestContext });

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
    const bookmarksTableName = process.env.BOOKMARKS_TABLE_NAME; // Needed to update bookmarks
    const bookmarksFolderIdGsiName = process.env.BOOKMARKS_FOLDER_ID_GSI_NAME; // GSI on folderId for bookmarks

    if (!bookmarkFoldersTableName || !bookmarksTableName || !bookmarksFolderIdGsiName) {
      log.error("Environment variables for table names or GSI names are not set.");
      return respondWithError(500, "Server configuration error.");
    }

    // First, get the folder to ensure it exists and belongs to the user
    const getFolderParams = {
      TableName: bookmarkFoldersTableName,
      Key: { id: folderId },
    };
    const getFolderResult = await dynamoDb.get(getFolderParams).promise();

    if (!getFolderResult.Item) {
      log.warn("Bookmark folder not found for deletion", { folderId, userId });
      return respondWithError(404, "Bookmark folder not found.");
    }

    if (getFolderResult.Item.userId !== userId) {
      log.warn("User attempted to delete a bookmark folder they do not own", { folderId, requestingUserId: userId, ownerUserId: getFolderResult.Item.userId });
      return respondWithError(403, "Forbidden: You do not have permission to delete this folder.");
    }

    // Decision: Orphan bookmarks and child folders. 
    // 1. Find all bookmarks in this folder and set their folderId to null.
    const listBookmarksParams = {
        TableName: bookmarksTableName,
        IndexName: bookmarksFolderIdGsiName, // Query GSI: folderId-index or similar
        KeyConditionExpression: "folderId = :folderId",
        ExpressionAttributeValues: { ":folderId": folderId },
    };

    const bookmarksInFolder = await dynamoDb.query(listBookmarksParams).promise();
    const updatePromises = [];

    if (bookmarksInFolder.Items && bookmarksInFolder.Items.length > 0) {
        for (const bookmark of bookmarksInFolder.Items) {
            // Ensure the bookmark also belongs to the same user before orphaning
            if (bookmark.userId === userId) {
                const updateBookmarkParams = {
                    TableName: bookmarksTableName,
                    Key: { id: bookmark.id },
                    UpdateExpression: "SET folderId = :nullFolderId, updatedAt = :updatedAt",
                    // Or use REMOVE folderId if you prefer it to be absent
                    // UpdateExpression: "REMOVE folderId SET updatedAt = :updatedAt",
                    ExpressionAttributeValues: {
                        ":nullFolderId": null, 
                        ":updatedAt": new Date().toISOString(),
                    },
                };
                updatePromises.push(dynamoDb.update(updateBookmarkParams).promise());
            }
        }
        await Promise.all(updatePromises);
        log.info(`Orphaned ${updatePromises.length} bookmarks from folder ${folderId}`);
    }
    
    // 2. Find child folders and set their parentFolderId to null (orphan them)
    // This requires a GSI on parentFolderId for bookmark_folders table
    const childFoldersGsiName = process.env.BOOKMARK_FOLDERS_PARENT_ID_GSI_NAME; // e.g., ParentIdIndex
    if (childFoldersGsiName) {
        const listChildFoldersParams = {
            TableName: bookmarkFoldersTableName,
            IndexName: childFoldersGsiName,
            KeyConditionExpression: "parentFolderId = :parentFolderId",
            ExpressionAttributeValues: { ":parentFolderId": folderId },
        };
        const childFoldersResult = await dynamoDb.query(listChildFoldersParams).promise();
        const updateChildFolderPromises = [];
        if (childFoldersResult.Items && childFoldersResult.Items.length > 0) {
            for (const childFolder of childFoldersResult.Items) {
                 if (childFolder.userId === userId) { // Ensure user owns child folder
                    const updateChildParams = {
                        TableName: bookmarkFoldersTableName,
                        Key: { id: childFolder.id },
                        UpdateExpression: "SET parentFolderId = :nullParentId, updatedAt = :updatedAt",
                        ExpressionAttributeValues: {
                            ":nullParentId": null,
                            ":updatedAt": new Date().toISOString(),
                        },
                    };
                    updateChildFolderPromises.push(dynamoDb.update(updateChildParams).promise());
                }
            }
            await Promise.all(updateChildFolderPromises);
            log.info(`Orphaned ${updateChildFolderPromises.length} child folders from parent folder ${folderId}`);
        }
    } else {
        log.warn("BOOKMARK_FOLDERS_PARENT_ID_GSI_NAME not set, cannot orphan child folders automatically.");
    }

    // 3. Delete the folder itself
    const deleteFolderParams = {
      TableName: bookmarkFoldersTableName,
      Key: {
        id: folderId,
      },
    };

    await dynamoDb.delete(deleteFolderParams).promise();
    log.info("Bookmark folder deleted successfully", { folderId, userId });

    // TODO: Record activity

    return respondWithSuccess(204, { message: "Bookmark folder deleted successfully. Contained bookmarks and child folders have been orphaned." });

  } catch (error) {
    log.error("Error deleting bookmark folder", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not delete bookmark folder. Please try again later.");
  }
};

