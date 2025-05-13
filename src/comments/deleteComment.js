const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to delete comment", { pathParameters: event.pathParameters, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const commentId = event.pathParameters?.id;
    if (!commentId) {
      return respondWithError(400, "Comment ID is required in the path.");
    }

    const commentsTableName = process.env.COMMENTS_TABLE_NAME;
    if (!commentsTableName) {
      log.error("Environment variable COMMENTS_TABLE_NAME is not set.");
      return respondWithError(500, "Server configuration error.");
    }

    // First, get the comment to ensure it exists and belongs to the user (or admin/moderator in future)
    const getParams = {
      TableName: commentsTableName,
      Key: { id: commentId },
      ProjectionExpression: "id, userId, resourceId, resourceType" // Only need these for verification and activity log
    };
    const getResult = await dynamoDb.get(getParams).promise();

    if (!getResult.Item) {
      log.warn("Comment not found for deletion", { commentId, userId });
      return respondWithError(404, "Comment not found.");
    }

    // Check if the user is the owner of the comment
    // In a more complex system, you might allow resource owners or admins to delete comments too.
    if (getResult.Item.userId !== userId) {
      log.warn("User attempted to delete a comment they do not own", { commentId, requestingUserId: userId, ownerUserId: getResult.Item.userId });
      return respondWithError(403, "Forbidden: You do not have permission to delete this comment.");
    }

    const deleteParams = {
      TableName: commentsTableName,
      Key: {
        id: commentId,
      },
    };

    await dynamoDb.delete(deleteParams).promise();
    log.info("Comment deleted successfully", { commentId, userId });

    // TODO: Record activity (e.g., comment deleted)
    // await recordActivity(userId, "DELETE_COMMENT", { commentId, resourceId: getResult.Item.resourceId, resourceType: getResult.Item.resourceType });

    // TODO: If there are child comments, decide on a deletion strategy (e.g., cascade delete, mark as deleted, re-parent)
    // For now, simple deletion of the target comment.

    return respondWithSuccess(204, { message: "Comment deleted successfully." }); // 204 No Content for successful deletion

  } catch (error) {
    log.error("Error deleting comment", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not delete comment. Please try again later.");
  }
};

