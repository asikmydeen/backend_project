const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to add photo to album", { pathParameters: event.pathParameters, body: event.body, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const { albumId } = event.pathParameters;
    if (!albumId) {
      return respondWithError(400, "Album ID is required.");
    }

    const requestBody = JSON.parse(event.body);
    const { photoId } = requestBody;

    if (!photoId) {
      return respondWithError(400, "Photo ID is required.");
    }

    const albumsTableName = process.env.ALBUMS_TABLE_NAME;
    const photosTableName = process.env.PHOTOS_TABLE_NAME;
    
    if (!albumsTableName || !photosTableName) {
      log.error("Environment variables not set", { albumsTableName, photosTableName });
      return respondWithError(500, "Server configuration error.");
    }

    // Verify the album exists and belongs to the user
    const albumParams = {
      TableName: albumsTableName,
      Key: { id: albumId },
    };

    const albumResult = await dynamoDb.get(albumParams).promise();
    if (!albumResult.Item) {
      return respondWithError(404, "Album not found.");
    }

    const album = albumResult.Item;
    
    if (album.userId !== userId) {
      return respondWithError(403, "You do not have permission to add photos to this album.");
    }

    // Verify the photo exists and belongs to the user
    const photoParams = {
      TableName: photosTableName,
      Key: { id: photoId },
    };

    const photoResult = await dynamoDb.get(photoParams).promise();
    if (!photoResult.Item) {
      return respondWithError(404, "Photo not found.");
    }

    const photo = photoResult.Item;
    
    if (photo.userId !== userId) {
      return respondWithError(403, "You do not have permission to add this photo to the album.");
    }

    // Update the photo to add it to the album
    const updatePhotoParams = {
      TableName: photosTableName,
      Key: { id: photoId },
      UpdateExpression: "set albumId = :albumId, updatedAt = :updatedAt",
      ExpressionAttributeValues: {
        ":albumId": albumId,
        ":updatedAt": new Date().toISOString(),
      },
      ReturnValues: "ALL_NEW",
    };

    const updatePhotoResult = await dynamoDb.update(updatePhotoParams).promise();

    // Update the album's photo count
    const updateAlbumParams = {
      TableName: albumsTableName,
      Key: { id: albumId },
      UpdateExpression: "set photoCount = photoCount + :increment, updatedAt = :updatedAt",
      ExpressionAttributeValues: {
        ":increment": 1,
        ":updatedAt": new Date().toISOString(),
      },
      ReturnValues: "ALL_NEW",
    };

    const updateAlbumResult = await dynamoDb.update(updateAlbumParams).promise();

    log.info("Photo added to album successfully", { photoId, albumId, userId });

    return respondWithSuccess(200, {
      photo: updatePhotoResult.Attributes,
      album: updateAlbumResult.Attributes,
    });

  } catch (error) {
    log.error("Error adding photo to album", { error: error.message, stack: error.stack });
    if (error instanceof SyntaxError) {
      return respondWithError(400, "Invalid JSON payload.");
    }
    return respondWithError(500, "Could not add photo to album. Please try again later.");
  }
};
