const AWS = require("aws-sdk");
const { v4: uuidv4 } = require("uuid");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to create album", { body: event.body, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const requestBody = JSON.parse(event.body);
    const { name, description, coverPhotoId, isPrivate, tags } = requestBody;

    if (!name) {
      return respondWithError(400, "Album name is required.");
    }

    const albumsTableName = process.env.ALBUMS_TABLE_NAME;
    if (!albumsTableName) {
      log.error("Environment variable ALBUMS_TABLE_NAME is not set.");
      return respondWithError(500, "Server configuration error.");
    }

    // If coverPhotoId is provided, verify it exists and belongs to the user
    if (coverPhotoId) {
      const photosTableName = process.env.PHOTOS_TABLE_NAME;
      if (!photosTableName) {
        log.error("Environment variable PHOTOS_TABLE_NAME is not set.");
        return respondWithError(500, "Server configuration error.");
      }

      const photoParams = {
        TableName: photosTableName,
        Key: { id: coverPhotoId },
      };

      const photoResult = await dynamoDb.get(photoParams).promise();
      if (!photoResult.Item) {
        return respondWithError(404, "Cover photo not found.");
      }

      if (photoResult.Item.userId !== userId) {
        return respondWithError(403, "You do not have permission to use this photo as cover.");
      }
    }

    const timestamp = new Date().toISOString();
    const albumId = uuidv4();

    const albumItem = {
      id: albumId,
      userId: userId,
      name: name,
      description: description || "",
      coverPhotoId: coverPhotoId || null,
      isPrivate: isPrivate !== undefined ? isPrivate : true,
      tags: tags || [],
      photoCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const dynamoParams = {
      TableName: albumsTableName,
      Item: albumItem,
    };

    await dynamoDb.put(dynamoParams).promise();
    log.info("Album created successfully", { albumId, userId });

    return respondWithSuccess(201, albumItem);

  } catch (error) {
    log.error("Error creating album", { error: error.message, stack: error.stack });
    if (error instanceof SyntaxError) {
      return respondWithError(400, "Invalid JSON payload.");
    }
    return respondWithError(500, "Could not create album. Please try again later.");
  }
};
