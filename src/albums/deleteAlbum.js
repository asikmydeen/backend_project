const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to delete album", { pathParameters: event.pathParameters, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const { albumId } = event.pathParameters;
    if (!albumId) {
      return respondWithError(400, "Album ID is required.");
    }

    const albumsTableName = process.env.ALBUMS_TABLE_NAME;
    const photosTableName = process.env.PHOTOS_TABLE_NAME;
    
    if (!albumsTableName || !photosTableName) {
      log.error("Environment variables not set", { albumsTableName, photosTableName });
      return respondWithError(500, "Server configuration error.");
    }

    // Get the album to verify ownership
    const getParams = {
      TableName: albumsTableName,
      Key: { id: albumId },
    };

    const result = await dynamoDb.get(getParams).promise();
    if (!result.Item) {
      return respondWithError(404, "Album not found.");
    }

    const album = result.Item;
    
    // Verify the album belongs to the user
    if (album.userId !== userId) {
      return respondWithError(403, "You do not have permission to delete this album.");
    }

    // Update all photos in the album to remove the albumId
    const photosParams = {
      TableName: photosTableName,
      FilterExpression: "albumId = :albumId",
      ExpressionAttributeValues: {
        ":albumId": albumId,
      },
    };

    const photosResult = await dynamoDb.scan(photosParams).promise();
    
    // Update each photo to remove the albumId
    const updatePromises = photosResult.Items.map(photo => {
      const updateParams = {
        TableName: photosTableName,
        Key: { id: photo.id },
        UpdateExpression: "set albumId = :albumId, updatedAt = :updatedAt",
        ExpressionAttributeValues: {
          ":albumId": null,
          ":updatedAt": new Date().toISOString(),
        },
      };
      return dynamoDb.update(updateParams).promise();
    });

    await Promise.all(updatePromises);

    // Delete the album
    const deleteParams = {
      TableName: albumsTableName,
      Key: { id: albumId },
    };

    await dynamoDb.delete(deleteParams).promise();
    log.info("Album deleted successfully", { albumId, userId });

    return respondWithSuccess(200, { message: "Album deleted successfully" });

  } catch (error) {
    log.error("Error deleting album", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not delete album. Please try again later.");
  }
};
