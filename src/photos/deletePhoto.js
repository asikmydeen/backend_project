const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3();

module.exports.handler = async (event) => {
  log.info("Received request to delete photo", { pathParameters: event.pathParameters, eventContext: event.requestContext });

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
    const bucketName = process.env.PHOTOS_BUCKET_NAME;
    
    if (!photosTableName || !bucketName) {
      log.error("Environment variables not set", { photosTableName, bucketName });
      return respondWithError(500, "Server configuration error.");
    }

    // Get the photo metadata to verify ownership and get the S3 key
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
      return respondWithError(403, "You do not have permission to delete this photo.");
    }

    // Delete the photo from S3
    const s3Params = {
      Bucket: bucketName,
      Key: photoMetadata.s3Key,
    };

    await s3.deleteObject(s3Params).promise();

    // Delete the photo metadata from DynamoDB
    const deleteParams = {
      TableName: photosTableName,
      Key: { id: photoId },
    };

    await dynamoDb.delete(deleteParams).promise();
    log.info("Photo deleted successfully", { photoId, userId });

    return respondWithSuccess(200, { message: "Photo deleted successfully" });

  } catch (error) {
    log.error("Error deleting photo", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not delete photo. Please try again later.");
  }
};
