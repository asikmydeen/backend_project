const AWS = require("aws-sdk");
const { v4: uuidv4 } = require("uuid");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const s3 = new AWS.S3();
const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to initiate photo upload", { body: event.body, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const requestBody = JSON.parse(event.body);
    const { fileName, fileType, fileSize, albumId, description, location, tags } = requestBody;

    if (!fileName || !fileType) {
      return respondWithError(400, "File name and file type are required.");
    }

    const photoId = uuidv4();
    const s3Key = `users/${userId}/photos/${photoId}/${fileName}`;
    const bucketName = process.env.PHOTOS_BUCKET_NAME;
    const photosTableName = process.env.PHOTOS_TABLE_NAME;

    if (!bucketName || !photosTableName) {
      log.error("Environment variables not set", { bucketName, photosTableName });
      return respondWithError(500, "Server configuration error.");
    }

    // Generate a presigned URL for uploading the photo
    const presignedUrl = s3.getSignedUrl("putObject", {
      Bucket: bucketName,
      Key: s3Key,
      ContentType: fileType,
      Expires: 300, // URL expires in 5 minutes
    });

    // Create a temporary photo metadata record
    const timestamp = new Date().toISOString();
    const photoMetadata = {
      id: photoId,
      userId: userId,
      fileName: fileName,
      fileType: fileType,
      fileSize: fileSize || 0,
      s3Key: s3Key,
      albumId: albumId || null,
      description: description || "",
      location: location || null,
      tags: tags || [],
      status: "pending", // Will be updated to "complete" after upload
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const dynamoParams = {
      TableName: photosTableName,
      Item: photoMetadata,
    };

    await dynamoDb.put(dynamoParams).promise();
    log.info("Photo upload initiated successfully", { photoId, userId });

    return respondWithSuccess(200, {
      photoId: photoId,
      presignedUrl: presignedUrl,
      photoMetadata: photoMetadata,
    });

  } catch (error) {
    log.error("Error initiating photo upload", { error: error.message, stack: error.stack });
    if (error instanceof SyntaxError) {
      return respondWithError(400, "Invalid JSON payload.");
    }
    return respondWithError(500, "Could not initiate photo upload. Please try again later.");
  }
};
