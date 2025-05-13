const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to get album", { pathParameters: event.pathParameters, eventContext: event.requestContext });

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
    if (!albumsTableName) {
      log.error("Environment variable ALBUMS_TABLE_NAME is not set.");
      return respondWithError(500, "Server configuration error.");
    }

    // Get the album
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
      return respondWithError(403, "You do not have permission to access this album.");
    }

    // Get the photos in the album
    const photosTableName = process.env.PHOTOS_TABLE_NAME;
    if (!photosTableName) {
      log.error("Environment variable PHOTOS_TABLE_NAME is not set.");
      return respondWithError(500, "Server configuration error.");
    }

    const photosParams = {
      TableName: photosTableName,
      FilterExpression: "albumId = :albumId",
      ExpressionAttributeValues: {
        ":albumId": albumId,
      },
    };

    const photosResult = await dynamoDb.scan(photosParams).promise();
    
    // Add the photos to the response
    const response = {
      ...album,
      photos: photosResult.Items || [],
    };

    log.info("Album retrieved successfully", { albumId, userId });
    return respondWithSuccess(200, response);

  } catch (error) {
    log.error("Error getting album", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not get album. Please try again later.");
  }
};
