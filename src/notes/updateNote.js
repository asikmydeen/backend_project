const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to update note", { pathParameters: event.pathParameters, body: event.body, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const noteId = event.pathParameters?.id;
    if (!noteId) {
      return respondWithError(400, "Note ID is required in the path.");
    }

    const requestBody = JSON.parse(event.body);
    const { title, content, tags, category, color, isPinned, isArchived } = requestBody;

    const notesTableName = process.env.NOTES_TABLE_NAME;
    if (!notesTableName) {
      log.error("Environment variable NOTES_TABLE_NAME is not set.");
      return respondWithError(500, "Server configuration error.");
    }

    // First, get the note to ensure it exists and belongs to the user
    const getParams = {
      TableName: notesTableName,
      Key: { id: noteId },
    };
    const getResult = await dynamoDb.get(getParams).promise();

    if (!getResult.Item) {
      log.warn("Note not found for update", { noteId, userId });
      return respondWithError(404, "Note not found.");
    }

    if (getResult.Item.userId !== userId) {
      log.warn("User attempted to update a note they do not own", { noteId, requestingUserId: userId, ownerUserId: getResult.Item.userId });
      return respondWithError(403, "Forbidden: You do not have permission to update this note.");
    }

    // Prepare update expression
    const timestamp = new Date().toISOString();
    let updateExpression = "SET updatedAt = :updatedAt";
    const expressionAttributeValues = { ":updatedAt": timestamp };
    const expressionAttributeNames = {}; // Not strictly needed if attribute names are simple

    if (title !== undefined) {
      updateExpression += ", title = :title";
      expressionAttributeValues[":title"] = title;
    }
    if (content !== undefined) {
      updateExpression += ", content = :content";
      expressionAttributeValues[":content"] = content;
    }
    if (tags !== undefined) {
      updateExpression += ", tags = :tags";
      expressionAttributeValues[":tags"] = tags; // Expecting an array
    }
    if (category !== undefined) {
      updateExpression += ", category = :category";
      expressionAttributeValues[":category"] = category;
    }
    if (color !== undefined) {
      updateExpression += ", color = :color";
      expressionAttributeValues[":color"] = color;
    }
    if (isPinned !== undefined) {
      updateExpression += ", isPinned = :isPinned";
      expressionAttributeValues[":isPinned"] = isPinned;
    }
    if (isArchived !== undefined) {
      updateExpression += ", isArchived = :isArchived";
      expressionAttributeValues[":isArchived"] = isArchived;
    }
    
    // If no updatable fields were provided other than timestamp
    if (Object.keys(expressionAttributeValues).length === 1 && expressionAttributeValues[":updatedAt"]) {
        // Optionally, one might choose to not perform an update if only timestamp would change
        // or simply proceed to touch the updatedAt field.
        // For now, we proceed if any valid field was in the body, or even if body was empty (just updates timestamp).
        // If body was empty, requestBody would be {} and none of the if(field !== undefined) would trigger.
        // Let's ensure at least one field was intended for update.
        if(Object.keys(requestBody).length === 0){
            return respondWithSuccess(200, { message: "No fields provided for update.", note: getResult.Item });
        }
    }

    const updateParams = {
      TableName: notesTableName,
      Key: { id: noteId }, // Assuming 'id' is the primary key
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      // ExpressionAttributeNames: expressionAttributeNames, // Use if attribute names conflict with DynamoDB reserved words
      ReturnValues: "UPDATED_NEW",
    };

    const updatedResult = await dynamoDb.update(updateParams).promise();
    log.info("Note updated successfully", { noteId, userId, updatedAttributes: updatedResult.Attributes });

    // TODO: Consider recording this activity in the ActivitiesTable

    return respondWithSuccess(200, updatedResult.Attributes);

  } catch (error) {
    log.error("Error updating note", { error: error.message, stack: error.stack });
    if (error instanceof SyntaxError) { // JSON.parse error
        return respondWithError(400, "Invalid JSON payload.");
    }
    return respondWithError(500, "Could not update note. Please try again later.");
  }
};

