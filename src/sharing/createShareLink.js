const AWS = require("aws-sdk");
const { v4: uuidv4 } = require("uuid");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to create share link", { body: event.body, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const requestBody = JSON.parse(event.body);
    const { resourceType, resourceId, expiresAt, password, allowDownload } = requestBody;

    if (!resourceType || !resourceId) {
      return respondWithError(400, "Resource type and resource ID are required.");
    }

    // Validate resource type
    const validResourceTypes = ["file", "folder", "photo", "album", "resume"];
    if (!validResourceTypes.includes(resourceType)) {
      return respondWithError(400, `Invalid resource type. Must be one of: ${validResourceTypes.join(", ")}`);
    }

    // Verify the resource exists and belongs to the user
    const resourceTableMap = {
      file: process.env.FILES_TABLE_NAME,
      folder: process.env.FOLDERS_TABLE_NAME,
      photo: process.env.PHOTOS_TABLE_NAME,
      album: process.env.ALBUMS_TABLE_NAME,
      resume: process.env.RESUME_VERSIONS_TABLE_NAME,
    };

    const resourceTableName = resourceTableMap[resourceType];
    if (!resourceTableName) {
      log.error(`Environment variable for ${resourceType} table is not set.`);
      return respondWithError(500, "Server configuration error.");
    }

    const resourceParams = {
      TableName: resourceTableName,
      Key: { id: resourceId },
    };

    const resourceResult = await dynamoDb.get(resourceParams).promise();
    if (!resourceResult.Item) {
      return respondWithError(404, `${resourceType.charAt(0).toUpperCase() + resourceType.slice(1)} not found.`);
    }

    const resource = resourceResult.Item;
    
    if (resource.userId !== userId) {
      return respondWithError(403, `You do not have permission to share this ${resourceType}.`);
    }

    const shareLinksTableName = process.env.SHARE_LINKS_TABLE_NAME;
    if (!shareLinksTableName) {
      log.error("Environment variable SHARE_LINKS_TABLE_NAME is not set.");
      return respondWithError(500, "Server configuration error.");
    }

    const timestamp = new Date().toISOString();
    const shareLinkId = uuidv4();
    const shareCode = generateShareCode();

    // Calculate expiration timestamp if provided
    let expirationTimestamp = null;
    if (expiresAt) {
      expirationTimestamp = new Date(expiresAt).toISOString();
    }

    const shareLinkItem = {
      id: shareLinkId,
      userId: userId,
      shareCode: shareCode,
      resourceType: resourceType,
      resourceId: resourceId,
      expiresAt: expirationTimestamp,
      password: password || null,
      allowDownload: allowDownload !== undefined ? allowDownload : true,
      accessCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const dynamoParams = {
      TableName: shareLinksTableName,
      Item: shareLinkItem,
    };

    await dynamoDb.put(dynamoParams).promise();
    log.info("Share link created successfully", { shareLinkId, userId, resourceType, resourceId });

    // Generate the full share URL
    const apiGatewayUrl = process.env.API_GATEWAY_URL || "https://api.example.com";
    const shareUrl = `${apiGatewayUrl}/share/${shareCode}`;

    return respondWithSuccess(201, {
      ...shareLinkItem,
      shareUrl: shareUrl,
    });

  } catch (error) {
    log.error("Error creating share link", { error: error.message, stack: error.stack });
    if (error instanceof SyntaxError) {
      return respondWithError(400, "Invalid JSON payload.");
    }
    return respondWithError(500, "Could not create share link. Please try again later.");
  }
};

// Helper function to generate a random share code
function generateShareCode(length = 8) {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}
