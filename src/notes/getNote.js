const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to get note", { pathParameters: event.pathParameters, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const noteId = event.pathParameters?.id;
    if (!noteId) {
      return respondWithError(400, "Note ID is required in the path.");
    }

    const notesTableName = process.env.NOTES_TABLE_NAME;
    if (!notesTableName) {
      log.error("Environment variable NOTES_TABLE_NAME is not set.");
      return respondWithError(500, "Server configuration error.");
    }

    const dynamoParams = {
      TableName: notesTableName,
      Key: {
        id: noteId,
        // userId: userId, // If userId is part of the composite primary key
      },
    };

    const result = await dynamoDb.get(dynamoParams).promise();

    if (!result.Item) {
      log.warn("Note not found", { noteId, userId });
      return respondWithError(404, "Note not found.");
    }

    // Verify that the note belongs to the requesting user
    if (result.Item.userId !== userId) {
      log.warn("User attempted to access a note they do not own", { noteId, requestingUserId: userId, ownerUserId: result.Item.userId });
      return respondWithError(403, "Forbidden: You do not have permission to access this note.");
    }

    log.info("Note retrieved successfully", { noteId, userId });
    return respondWithSuccess(200, result.Item);

  } catch (error) {
    log.error("Error getting note", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not retrieve note. Please try again later.");
  }
};

