const AWS = require("aws-sdk");
const { v4: uuidv4 } = require("uuid");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to create bookmark", { body: event.body, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const requestBody = JSON.parse(event.body);
    const { url, title, description, tags, category, favicon, folderId } = requestBody;

    if (!url || !title) {
      return respondWithError(400, "URL and title are required to create a bookmark.");
    }

    const bookmarksTableName = process.env.BOOKMARKS_TABLE_NAME;
    if (!bookmarksTableName) {
      log.error("Environment variable BOOKMARKS_TABLE_NAME is not set.");
      return respondWithError(500, "Server configuration error.");
    }

    const timestamp = new Date().toISOString();
    const bookmarkId = uuidv4();

    const bookmarkItem = {
      id: bookmarkId,
      userId: userId,
      url: url,
      title: title,
      description: description || "",
      tags: tags || [], // Expecting an array of strings
      category: category || "general",
      favicon: favicon || null, // Client provides URL, backend stores/returns
      folderId: folderId || null, // Optional: for assigning to a bookmark folder
      createdAt: timestamp,
      updatedAt: timestamp,
      // Add other fields from db.json if necessary, e.g., clickCount (future)
    };

    const dynamoParams = {
      TableName: bookmarksTableName,
      Item: bookmarkItem,
    };

    await dynamoDb.put(dynamoParams).promise();
    log.info("Bookmark created successfully", { bookmarkId, userId });

    // TODO: Consider recording this activity in the ActivitiesTable
    // await recordActivity(userId, "CREATE_BOOKMARK", { bookmarkId, title });

    return respondWithSuccess(201, bookmarkItem);

  } catch (error) {
    log.error("Error creating bookmark", { error: error.message, stack: error.stack });
    if (error instanceof SyntaxError) { // JSON.parse error
        return respondWithError(400, "Invalid JSON payload.");
    }
    return respondWithError(500, "Could not create bookmark. Please try again later.");
  }
};

