const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to update photo details", { pathParameters: event.pathParameters, body: event.body, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const { photoId } = event.pathParameters;
    if (!photoId) {
      return respondWithError(400, "Photo ID is required.");
    }

    const photosTableName = process.env.PHOTOS_TABLE_NAME;
    if (!photosTableName) {
      log.error("Environment variable PHOTOS_TABLE_NAME is not set.");
      return respondWithError(500, "Server configuration error.");
    }

    // Get the existing photo metadata
    const getParams = {
      TableName: photosTableName,
      Key: { id: photoId },
    };

    const result = await dynamoDb.get(getParams).promise();
    if (!result.Item) {
      return respondWithError(404, "Photo not found.");
    }

    const photoMetadata = result.Item;
    
    // Verify the photo belongs to the user
    if (photoMetadata.userId !== userId) {
      return respondWithError(403, "You do not have permission to update this photo.");
    }

    const requestBody = JSON.parse(event.body);
    const { fileName, albumId, description, location, tags } = requestBody;

    // Build update expression and attribute values
    let updateExpression = "set updatedAt = :updatedAt";
    const expressionAttributeValues = {
      ":updatedAt": new Date().toISOString(),
    };

    if (fileName) {
      updateExpression += ", fileName = :fileName";
      expressionAttributeValues[":fileName"] = fileName;
    }

    if (albumId !== undefined) {
      updateExpression += ", albumId = :albumId";
      expressionAttributeValues[":albumId"] = albumId || null;
    }

    if (description !== undefined) {
      updateExpression += ", description = :description";
      expressionAttributeValues[":description"] = description || "";
    }

    if (location !== undefined) {
      updateExpression += ", #location = :location";
      expressionAttributeValues[":location"] = location || null;
    }

    if (tags !== undefined) {
      updateExpression += ", tags = :tags";
      expressionAttributeValues[":tags"] = tags || [];
    }

    const updateParams = {
      TableName: photosTableName,
      Key: { id: photoId },
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ExpressionAttributeNames: location !== undefined ? { "#location": "location" } : undefined,
      ReturnValues: "ALL_NEW",
    };

    const updateResult = await dynamoDb.update(updateParams).promise();
    log.info("Photo details updated successfully", { photoId, userId });

    return respondWithSuccess(200, updateResult.Attributes);

  } catch (error) {
    log.error("Error updating photo details", { error: error.message, stack: error.stack });
    if (error instanceof SyntaxError) {
      return respondWithError(400, "Invalid JSON payload.");
    }
    return respondWithError(500, "Could not update photo details. Please try again later.");
  }
};
