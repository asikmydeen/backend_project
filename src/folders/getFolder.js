const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to get folder", { pathParameters: event.pathParameters, eventContext: event.requestContext });

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
    if (!foldersTableName) {
      log.error("Environment variable FOLDERS_TABLE_NAME is not set.");
      return respondWithError(500, "Server configuration error.");
    }

    // Get the folder
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
      return respondWithError(403, "You do not have permission to access this folder.");
    }

    log.info("Folder retrieved successfully", { folderId, userId });
    return respondWithSuccess(200, folder);

  } catch (error) {
    log.error("Error getting folder", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not get folder. Please try again later.");
  }
};
