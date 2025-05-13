const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to update comment", { pathParameters: event.pathParameters, body: event.body, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const commentId = event.pathParameters?.id;
    if (!commentId) {
      return respondWithError(400, "Comment ID is required in the path.");
    }

    const requestBody = JSON.parse(event.body);
    const { content } = requestBody;

    if (!content || typeof content !== 'string' || content.trim() === '') {
      return respondWithError(400, "Comment content is required and cannot be empty.");
    }

    const commentsTableName = process.env.COMMENTS_TABLE_NAME;
    if (!commentsTableName) {
      log.error("Environment variable COMMENTS_TABLE_NAME is not set.");
      return respondWithError(500, "Server configuration error.");
    }

    // First, get the comment to ensure it exists and belongs to the user
    const getParams = {
      TableName: commentsTableName,
      Key: { id: commentId },
    };
    const getResult = await dynamoDb.get(getParams).promise();

    if (!getResult.Item) {
      log.warn("Comment not found for update", { commentId, userId });
      return respondWithError(404, "Comment not found.");
    }

    if (getResult.Item.userId !== userId) {
      log.warn("User attempted to update a comment they do not own", { commentId, requestingUserId: userId, ownerUserId: getResult.Item.userId });
      return respondWithError(403, "Forbidden: You do not have permission to update this comment.");
    }

    const timestamp = new Date().toISOString();
    const updateParams = {
      TableName: commentsTableName,
      Key: { id: commentId },
      UpdateExpression: "SET content = :content, updatedAt = :updatedAt, isEdited = :isEdited",
      ExpressionAttributeValues: {
        ":content": content.trim(),
        ":updatedAt": timestamp,
        ":isEdited": true,
      },
      ReturnValues: "ALL_NEW", // Get all attributes of the updated item
    };

    const updatedResult = await dynamoDb.update(updateParams).promise();
    log.info("Comment updated successfully", { commentId, userId });

    // TODO: Record activity (e.g., comment updated)
    // await recordActivity(userId, "UPDATE_COMMENT", { commentId, resourceId: updatedResult.Attributes.resourceId });

    return respondWithSuccess(200, updatedResult.Attributes);

  } catch (error) {
    log.error("Error updating comment", { error: error.message, stack: error.stack });
    if (error instanceof SyntaxError) {
        return respondWithError(400, "Invalid JSON payload.");
    }
    return respondWithError(500, "Could not update comment. Please try again later.");
  }
};

