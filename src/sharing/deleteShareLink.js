const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to delete share link", { pathParameters: event.pathParameters, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const { shareLinkId } = event.pathParameters;
    if (!shareLinkId) {
      return respondWithError(400, "Share link ID is required.");
    }

    const shareLinksTableName = process.env.SHARE_LINKS_TABLE_NAME;
    if (!shareLinksTableName) {
      log.error("Environment variable SHARE_LINKS_TABLE_NAME is not set.");
      return respondWithError(500, "Server configuration error.");
    }

    // Get the share link to verify ownership
    const getParams = {
      TableName: shareLinksTableName,
      Key: { id: shareLinkId },
    };

    const result = await dynamoDb.get(getParams).promise();
    if (!result.Item) {
      return respondWithError(404, "Share link not found.");
    }

    const shareLink = result.Item;
    
    // Verify the share link belongs to the user
    if (shareLink.userId !== userId) {
      return respondWithError(403, "You do not have permission to delete this share link.");
    }

    // Delete the share link
    const deleteParams = {
      TableName: shareLinksTableName,
      Key: { id: shareLinkId },
    };

    await dynamoDb.delete(deleteParams).promise();
    log.info("Share link deleted successfully", { shareLinkId, userId });

    return respondWithSuccess(200, { message: "Share link deleted successfully" });

  } catch (error) {
    log.error("Error deleting share link", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not delete share link. Please try again later.");
  }
};
