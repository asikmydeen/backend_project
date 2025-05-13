const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3();

module.exports.handler = async (event) => {
  log.info("Received request to get photo details", { pathParameters: event.pathParameters, eventContext: event.requestContext });

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

    // Get the photo metadata
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
      return respondWithError(403, "You do not have permission to access this photo.");
    }

    // Generate a presigned URL for viewing the photo
    const presignedUrl = s3.getSignedUrl("getObject", {
      Bucket: bucketName,
      Key: photoMetadata.s3Key,
      Expires: 3600, // URL expires in 1 hour
    });

    // Add the presigned URL to the response
    const response = {
      ...photoMetadata,
      presignedUrl: presignedUrl,
    };

    log.info("Photo details retrieved successfully", { photoId, userId });
    return respondWithSuccess(200, response);

  } catch (error) {
    log.error("Error getting photo details", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not get photo details. Please try again later.");
  }
};
