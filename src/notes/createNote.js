const AWS = require("aws-sdk");
const { v4: uuidv4 } = require("uuid"); // For generating unique IDs
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to create note", { body: event.body, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const requestBody = JSON.parse(event.body);
    const { title, content, tags, category, color, isPinned, isArchived } = requestBody;

    if (!title && !content) {
      return respondWithError(400, "Either title or content is required to create a note.");
    }

    const notesTableName = process.env.NOTES_TABLE_NAME;
    if (!notesTableName) {
      log.error("Environment variable NOTES_TABLE_NAME is not set.");
      return respondWithError(500, "Server configuration error.");
    }

    const timestamp = new Date().toISOString();
    const noteId = uuidv4();

    const noteItem = {
      id: noteId,
      userId: userId,
      title: title || "", // Default to empty string if not provided
      content: content || "", // Default to empty string if not provided
      tags: tags || [], // Expecting an array of strings
      category: category || "general", // Default category
      color: color || "#ffffff", // Default color (white)
      isPinned: isPinned || false,
      isArchived: isArchived || false,
      createdAt: timestamp,
      updatedAt: timestamp,
      // Add other fields from db.json if necessary, e.g., reminders, attachments (future)
    };

    const dynamoParams = {
      TableName: notesTableName,
      Item: noteItem,
    };

    await dynamoDb.put(dynamoParams).promise();
    log.info("Note created successfully", { noteId, userId });

    // TODO: Consider recording this activity in the ActivitiesTable
    // await recordActivity(userId, "CREATE_NOTE", { noteId, title });

    // TODO: Consider creating notifications if the note involves collaboration (future)

    return respondWithSuccess(201, noteItem);

  } catch (error) {
    log.error("Error creating note", { error: error.message, stack: error.stack });
    if (error instanceof SyntaxError) { // JSON.parse error
        return respondWithError(400, "Invalid JSON payload.");
    }
    return respondWithError(500, "Could not create note. Please try again later.");
  }
};

