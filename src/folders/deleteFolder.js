const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to delete folder", { pathParameters: event.pathParameters, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const { folderId } = event.pathParameters;
    if (!folderId) {
      return respondWithError(400, "Folder ID is required.");
    }

    const foldersTableName = process.env.FOLDERS_TABLE_NAME;
    const filesTableName = process.env.FILES_TABLE_NAME;
    
    if (!foldersTableName || !filesTableName) {
      log.error("Environment variables not set", { foldersTableName, filesTableName });
      return respondWithError(500, "Server configuration error.");
    }

    // Get the folder to verify ownership
    const getParams = {
      TableName: foldersTableName,
      Key: { id: folderId },
    };

    const result = await dynamoDb.get(getParams).promise();
    if (!result.Item) {
      return respondWithError(404, "Folder not found.");
    }

    const folder = result.Item;
    
    // Verify the folder belongs to the user
    if (folder.userId !== userId) {
      return respondWithError(403, "You do not have permission to delete this folder.");
    }

    // Check if the folder has any subfolders
    const subfolderParams = {
      TableName: foldersTableName,
      FilterExpression: "parentFolderId = :folderId",
      ExpressionAttributeValues: {
        ":folderId": folderId,
      },
    };

    const subfolderResult = await dynamoDb.scan(subfolderParams).promise();
    if (subfolderResult.Count > 0) {
      return respondWithError(400, "Cannot delete folder with subfolders. Please delete subfolders first.");
    }

    // Check if the folder has any files
    const fileParams = {
      TableName: filesTableName,
      FilterExpression: "folderId = :folderId",
      ExpressionAttributeValues: {
        ":folderId": folderId,
      },
    };

    const fileResult = await dynamoDb.scan(fileParams).promise();
    if (fileResult.Count > 0) {
      return respondWithError(400, "Cannot delete folder with files. Please delete files first or move them to another folder.");
    }

    // Delete the folder
    const deleteParams = {
      TableName: foldersTableName,
      Key: { id: folderId },
    };

    await dynamoDb.delete(deleteParams).promise();
    log.info("Folder deleted successfully", { folderId, userId });

    return respondWithSuccess(200, { message: "Folder deleted successfully" });

  } catch (error) {
    log.error("Error deleting folder", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not delete folder. Please try again later.");
  }
};
