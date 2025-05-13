const AWS = require("aws-sdk");
const { v4: uuidv4 } = require("uuid");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const s3 = new AWS.S3();
const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to initiate file upload", { body: event.body, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const requestBody = JSON.parse(event.body);
    const { fileName, fileType, fileSize, folderId } = requestBody;

    if (!fileName || !fileType) {
      return respondWithError(400, "File name and file type are required.");
    }

    const fileId = uuidv4();
    const s3Key = `users/${userId}/files/${fileId}/${fileName}`;
    const bucketName = process.env.FILES_BUCKET_NAME;
    const filesTableName = process.env.FILES_TABLE_NAME;

    if (!bucketName || !filesTableName) {
      log.error("Environment variables not set", { bucketName, filesTableName });
      return respondWithError(500, "Server configuration error.");
    }

    // Generate a presigned URL for uploading the file
    const presignedUrl = s3.getSignedUrl("putObject", {
      Bucket: bucketName,
      Key: s3Key,
      ContentType: fileType,
      Expires: 300, // URL expires in 5 minutes
    });

    // Create a temporary file metadata record
    const timestamp = new Date().toISOString();
    const fileMetadata = {
      id: fileId,
      userId: userId,
      fileName: fileName,
      fileType: fileType,
      fileSize: fileSize || 0,
      s3Key: s3Key,
      folderId: folderId || null,
      status: "pending", // Will be updated to "complete" after upload
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const dynamoParams = {
      TableName: filesTableName,
      Item: fileMetadata,
    };

    await dynamoDb.put(dynamoParams).promise();
    log.info("File upload initiated successfully", { fileId, userId });

    return respondWithSuccess(200, {
      fileId: fileId,
      presignedUrl: presignedUrl,
      fileMetadata: fileMetadata,
    });

  } catch (error) {
    log.error("Error initiating file upload", { error: error.message, stack: error.stack });
    if (error instanceof SyntaxError) {
      return respondWithError(400, "Invalid JSON payload.");
    }
    return respondWithError(500, "Could not initiate file upload. Please try again later.");
  }
};
