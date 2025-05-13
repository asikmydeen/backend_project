const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to delete note", { pathParameters: event.pathParameters, eventContext: event.requestContext });

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

    // First, get the note to ensure it exists and belongs to the user before deleting
    const getParams = {
      TableName: notesTableName,
      Key: { id: noteId },
    };
    const getResult = await dynamoDb.get(getParams).promise();

    if (!getResult.Item) {
      log.warn("Note not found for deletion", { noteId, userId });
      // Return 204 even if not found to make it idempotent, or 404 if strictness is preferred.
      // For now, returning 404 for clarity during development.
      return respondWithError(404, "Note not found.");
    }

    if (getResult.Item.userId !== userId) {
      log.warn("User attempted to delete a note they do not own", { noteId, requestingUserId: userId, ownerUserId: getResult.Item.userId });
      return respondWithError(403, "Forbidden: You do not have permission to delete this note.");
    }

    const deleteParams = {
      TableName: notesTableName,
      Key: {
        id: noteId,
        // userId: userId, // If userId is part of the composite primary key
      },
      // Optional: ConditionExpression to ensure it still belongs to the user, though checked above
      // ConditionExpression: "userId = :userId",
      // ExpressionAttributeValues: { ":userId": userId }
    };

    await dynamoDb.delete(deleteParams).promise();
    log.info("Note deleted successfully", { noteId, userId });

    // TODO: Consider recording this activity in the ActivitiesTable

    return respondWithSuccess(204, { message: "Note deleted successfully." }); // 204 No Content is typical for successful DELETE

  } catch (error) {
    log.error("Error deleting note", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not delete note. Please try again later.");
  }
};

