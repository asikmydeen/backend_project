const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to remove photo from album", { pathParameters: event.pathParameters, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const { albumId, photoId } = event.pathParameters;
    if (!albumId || !photoId) {
      return respondWithError(400, "Album ID and Photo ID are required.");
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
      return respondWithError(403, "You do not have permission to remove photos from this album.");
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
      return respondWithError(403, "You do not have permission to remove this photo from the album.");
    }

    // Verify the photo is in the album
    if (photo.albumId !== albumId) {
      return respondWithError(400, "Photo is not in this album.");
    }

    // Update the photo to remove it from the album
    const updatePhotoParams = {
      TableName: photosTableName,
      Key: { id: photoId },
      UpdateExpression: "set albumId = :albumId, updatedAt = :updatedAt",
      ExpressionAttributeValues: {
        ":albumId": null,
        ":updatedAt": new Date().toISOString(),
      },
      ReturnValues: "ALL_NEW",
    };

    const updatePhotoResult = await dynamoDb.update(updatePhotoParams).promise();

    // Update the album's photo count
    const updateAlbumParams = {
      TableName: albumsTableName,
      Key: { id: albumId },
      UpdateExpression: "set photoCount = photoCount - :decrement, updatedAt = :updatedAt",
      ExpressionAttributeValues: {
        ":decrement": 1,
        ":updatedAt": new Date().toISOString(),
      },
      ConditionExpression: "photoCount > :zero",
      ExpressionAttributeValues: {
        ":decrement": 1,
        ":updatedAt": new Date().toISOString(),
        ":zero": 0,
      },
      ReturnValues: "ALL_NEW",
    };

    const updateAlbumResult = await dynamoDb.update(updateAlbumParams).promise();

    log.info("Photo removed from album successfully", { photoId, albumId, userId });

    return respondWithSuccess(200, {
      photo: updatePhotoResult.Attributes,
      album: updateAlbumResult.Attributes,
    });

  } catch (error) {
    log.error("Error removing photo from album", { error: error.message, stack: error.stack });
    if (error.code === "ConditionalCheckFailedException") {
      return respondWithError(400, "Photo count is already zero.");
    }
    return respondWithError(500, "Could not remove photo from album. Please try again later.");
  }
};
