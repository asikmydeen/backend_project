const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3();

module.exports.handler = async (event) => {
  log.info("Received request to complete photo upload", { body: event.body, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const requestBody = JSON.parse(event.body);
    const { photoId } = requestBody;

    if (!photoId) {
      return respondWithError(400, "Photo ID is required.");
    }

    const photosTableName = process.env.PHOTOS_TABLE_NAME;
    const bucketName = process.env.PHOTOS_BUCKET_NAME;
    
    if (!photosTableName || !bucketName) {
      log.error("Environment variables not set", { photosTableName, bucketName });
      return respondWithError(500, "Server configuration error.");
    }

    // Get the existing photo metadata
    const getParams = {
      TableName: photosTableName,
      Key: { id: photoId },
    };

    const result = await dynamoDb.get(getParams).promise();
    if (!result.Item) {
      return respondWithError(404, "Photo metadata not found.");
    }

    const photoMetadata = result.Item;
    
    // Verify the photo belongs to the user
    if (photoMetadata.userId !== userId) {
      return respondWithError(403, "You do not have permission to update this photo.");
    }

    // Verify the photo exists in S3
    try {
      await s3.headObject({
        Bucket: bucketName,
        Key: photoMetadata.s3Key,
      }).promise();
    } catch (error) {
      log.error("Photo not found in S3", { error: error.message, photoId, s3Key: photoMetadata.s3Key });
      return respondWithError(404, "Photo file not found. Upload may have failed.");
    }

    // Update the photo metadata
    const timestamp = new Date().toISOString();
    const updateParams = {
      TableName: photosTableName,
      Key: { id: photoId },
      UpdateExpression: "set #status = :status, updatedAt = :updatedAt",
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":status": "complete",
        ":updatedAt": timestamp,
      },
      ReturnValues: "ALL_NEW",
    };

    const updateResult = await dynamoDb.update(updateParams).promise();
    log.info("Photo upload completed successfully", { photoId, userId });

    return respondWithSuccess(200, updateResult.Attributes);

  } catch (error) {
    log.error("Error completing photo upload", { error: error.message, stack: error.stack });
    if (error instanceof SyntaxError) {
      return respondWithError(400, "Invalid JSON payload.");
    }
    return respondWithError(500, "Could not complete photo upload. Please try again later.");
  }
};
