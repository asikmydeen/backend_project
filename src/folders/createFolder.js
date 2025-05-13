const AWS = require("aws-sdk");
const { v4: uuidv4 } = require("uuid");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to create folder", { body: event.body, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const requestBody = JSON.parse(event.body);
    const { name, parentFolderId, description } = requestBody;

    if (!name) {
      return respondWithError(400, "Folder name is required.");
    }

    const foldersTableName = process.env.FOLDERS_TABLE_NAME;
    if (!foldersTableName) {
      log.error("Environment variable FOLDERS_TABLE_NAME is not set.");
      return respondWithError(500, "Server configuration error.");
    }

    // If parentFolderId is provided, verify it exists and belongs to the user
    if (parentFolderId) {
      const getParams = {
        TableName: foldersTableName,
        Key: { id: parentFolderId },
      };

      const result = await dynamoDb.get(getParams).promise();
      if (!result.Item) {
        return respondWithError(404, "Parent folder not found.");
      }

      if (result.Item.userId !== userId) {
        return respondWithError(403, "You do not have permission to create a folder in this parent folder.");
      }
    }

    const timestamp = new Date().toISOString();
    const folderId = uuidv4();

    const folderItem = {
      id: folderId,
      userId: userId,
      name: name,
      parentFolderId: parentFolderId || null, // Root folders will have null parentFolderId
      description: description || "",
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const dynamoParams = {
      TableName: foldersTableName,
      Item: folderItem,
    };

    await dynamoDb.put(dynamoParams).promise();
    log.info("Folder created successfully", { folderId, userId });

    return respondWithSuccess(201, folderItem);

  } catch (error) {
    log.error("Error creating folder", { error: error.message, stack: error.stack });
    if (error instanceof SyntaxError) {
      return respondWithError(400, "Invalid JSON payload.");
    }
    return respondWithError(500, "Could not create folder. Please try again later.");
  }
};
