const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to update album", { pathParameters: event.pathParameters, body: event.body, eventContext: event.requestContext });

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

    // Get the existing album
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
      return respondWithError(403, "You do not have permission to update this album.");
    }

    const requestBody = JSON.parse(event.body);
    const { name, description, coverPhotoId, isPrivate, tags } = requestBody;

    // Validate name if provided
    if (name !== undefined && !name) {
      return respondWithError(400, "Album name cannot be empty.");
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

    // Build update expression and attribute values
    let updateExpression = "set updatedAt = :updatedAt";
    const expressionAttributeValues = {
      ":updatedAt": new Date().toISOString(),
    };

    if (name !== undefined) {
      updateExpression += ", #name = :name";
      expressionAttributeValues[":name"] = name;
    }

    if (description !== undefined) {
      updateExpression += ", description = :description";
      expressionAttributeValues[":description"] = description;
    }

    if (coverPhotoId !== undefined) {
      updateExpression += ", coverPhotoId = :coverPhotoId";
      expressionAttributeValues[":coverPhotoId"] = coverPhotoId || null;
    }

    if (isPrivate !== undefined) {
      updateExpression += ", isPrivate = :isPrivate";
      expressionAttributeValues[":isPrivate"] = isPrivate;
    }

    if (tags !== undefined) {
      updateExpression += ", tags = :tags";
      expressionAttributeValues[":tags"] = tags || [];
    }

    const updateParams = {
      TableName: albumsTableName,
      Key: { id: albumId },
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ExpressionAttributeNames: {
        "#name": "name", // name is a reserved word in DynamoDB
      },
      ReturnValues: "ALL_NEW",
    };

    const updateResult = await dynamoDb.update(updateParams).promise();
    log.info("Album updated successfully", { albumId, userId });

    return respondWithSuccess(200, updateResult.Attributes);

  } catch (error) {
    log.error("Error updating album", { error: error.message, stack: error.stack });
    if (error instanceof SyntaxError) {
      return respondWithError(400, "Invalid JSON payload.");
    }
    return respondWithError(500, "Could not update album. Please try again later.");
  }
};
