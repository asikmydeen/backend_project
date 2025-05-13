const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to get share link", { pathParameters: event.pathParameters, eventContext: event.requestContext });

  try {
    const { shareCode } = event.pathParameters;
    if (!shareCode) {
      return respondWithError(400, "Share code is required.");
    }

    const shareLinksTableName = process.env.SHARE_LINKS_TABLE_NAME;
    if (!shareLinksTableName) {
      log.error("Environment variable SHARE_LINKS_TABLE_NAME is not set.");
      return respondWithError(500, "Server configuration error.");
    }

    // Find the share link by share code
    const queryParams = {
      TableName: shareLinksTableName,
      IndexName: "ShareCodeIndex", // Assuming a GSI on shareCode
      KeyConditionExpression: "shareCode = :shareCode",
      ExpressionAttributeValues: {
        ":shareCode": shareCode,
      },
    };

    const queryResult = await dynamoDb.query(queryParams).promise();
    if (queryResult.Items.length === 0) {
      return respondWithError(404, "Share link not found.");
    }

    const shareLink = queryResult.Items[0];
    
    // Check if the share link has expired
    if (shareLink.expiresAt && new Date(shareLink.expiresAt) < new Date()) {
      return respondWithError(410, "This share link has expired.");
    }

    // If password is required, don't return the resource details yet
    if (shareLink.password) {
      return respondWithSuccess(200, {
        id: shareLink.id,
        shareCode: shareLink.shareCode,
        resourceType: shareLink.resourceType,
        passwordRequired: true,
        allowDownload: shareLink.allowDownload,
      });
    }

    // Get the resource details
    const resourceTableMap = {
      file: process.env.FILES_TABLE_NAME,
      folder: process.env.FOLDERS_TABLE_NAME,
      photo: process.env.PHOTOS_TABLE_NAME,
      album: process.env.ALBUMS_TABLE_NAME,
      resume: process.env.RESUME_VERSIONS_TABLE_NAME,
    };

    const resourceTableName = resourceTableMap[shareLink.resourceType];
    if (!resourceTableName) {
      log.error(`Environment variable for ${shareLink.resourceType} table is not set.`);
      return respondWithError(500, "Server configuration error.");
    }

    const resourceParams = {
      TableName: resourceTableName,
      Key: { id: shareLink.resourceId },
    };

    const resourceResult = await dynamoDb.get(resourceParams).promise();
    if (!resourceResult.Item) {
      return respondWithError(404, `${shareLink.resourceType.charAt(0).toUpperCase() + shareLink.resourceType.slice(1)} not found.`);
    }

    const resource = resourceResult.Item;

    // Increment the access count
    const updateParams = {
      TableName: shareLinksTableName,
      Key: { id: shareLink.id },
      UpdateExpression: "set accessCount = accessCount + :increment, updatedAt = :updatedAt",
      ExpressionAttributeValues: {
        ":increment": 1,
        ":updatedAt": new Date().toISOString(),
      },
    };

    await dynamoDb.update(updateParams).promise();

    // Return the share link and resource details
    return respondWithSuccess(200, {
      shareLink: {
        id: shareLink.id,
        shareCode: shareLink.shareCode,
        resourceType: shareLink.resourceType,
        resourceId: shareLink.resourceId,
        expiresAt: shareLink.expiresAt,
        allowDownload: shareLink.allowDownload,
        accessCount: shareLink.accessCount + 1,
        createdAt: shareLink.createdAt,
      },
      resource: resource,
    });

  } catch (error) {
    log.error("Error getting share link", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not get share link. Please try again later.");
  }
};
