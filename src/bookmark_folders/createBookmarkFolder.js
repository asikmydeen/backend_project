const AWS = require("aws-sdk");
const { v4: uuidv4 } = require("uuid");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to create bookmark folder", { body: event.body, eventContext: event.requestContext });

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

    const bookmarkFoldersTableName = process.env.BOOKMARK_FOLDERS_TABLE_NAME;
    if (!bookmarkFoldersTableName) {
      log.error("Environment variable BOOKMARK_FOLDERS_TABLE_NAME is not set.");
      return respondWithError(500, "Server configuration error.");
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
      // Consider adding path or depth for easier querying of nested structures if needed
    };

    const dynamoParams = {
      TableName: bookmarkFoldersTableName,
      Item: folderItem,
    };

    await dynamoDb.put(dynamoParams).promise();
    log.info("Bookmark folder created successfully", { folderId, userId });

    // TODO: Record activity

    return respondWithSuccess(201, folderItem);

  } catch (error) {
    log.error("Error creating bookmark folder", { error: error.message, stack: error.stack });
    if (error instanceof SyntaxError) {
        return respondWithError(400, "Invalid JSON payload.");
    }
    return respondWithError(500, "Could not create bookmark folder. Please try again later.");
  }
};

