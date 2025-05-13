const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to update share link", { pathParameters: event.pathParameters, body: event.body, eventContext: event.requestContext });

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

    // Get the existing share link
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
      return respondWithError(403, "You do not have permission to update this share link.");
    }

    const requestBody = JSON.parse(event.body);
    const { expiresAt, password, allowDownload } = requestBody;

    // Calculate expiration timestamp if provided
    let expirationTimestamp = null;
    if (expiresAt) {
      expirationTimestamp = new Date(expiresAt).toISOString();
    }

    // Build update expression and attribute values
    let updateExpression = "set updatedAt = :updatedAt";
    const expressionAttributeValues = {
      ":updatedAt": new Date().toISOString(),
    };

    if (expiresAt !== undefined) {
      updateExpression += ", expiresAt = :expiresAt";
      expressionAttributeValues[":expiresAt"] = expirationTimestamp;
    }

    if (password !== undefined) {
      updateExpression += ", password = :password";
      expressionAttributeValues[":password"] = password || null;
    }

    if (allowDownload !== undefined) {
      updateExpression += ", allowDownload = :allowDownload";
      expressionAttributeValues[":allowDownload"] = allowDownload;
    }

    const updateParams = {
      TableName: shareLinksTableName,
      Key: { id: shareLinkId },
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: "ALL_NEW",
    };

    const updateResult = await dynamoDb.update(updateParams).promise();
    log.info("Share link updated successfully", { shareLinkId, userId });

    // Generate the full share URL
    const apiGatewayUrl = process.env.API_GATEWAY_URL || "https://api.example.com";
    const shareUrl = `${apiGatewayUrl}/share/${updateResult.Attributes.shareCode}`;

    return respondWithSuccess(200, {
      ...updateResult.Attributes,
      shareUrl: shareUrl,
    });

  } catch (error) {
    log.error("Error updating share link", { error: error.message, stack: error.stack });
    if (error instanceof SyntaxError) {
      return respondWithError(400, "Invalid JSON payload.");
    }
    return respondWithError(500, "Could not update share link. Please try again later.");
  }
};
