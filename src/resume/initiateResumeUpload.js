const AWS = require("aws-sdk");
const { v4: uuidv4 } = require("uuid");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const s3 = new AWS.S3();
const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to initiate resume upload", { body: event.body, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const requestBody = JSON.parse(event.body);
    const { fileName, fileType, fileSize, title, description, tags } = requestBody;

    if (!fileName || !fileType) {
      return respondWithError(400, "File name and file type are required.");
    }

    const versionId = uuidv4();
    const s3Key = `users/${userId}/resumes/${versionId}/${fileName}`;
    const bucketName = process.env.RESUMES_BUCKET_NAME;
    const resumeVersionsTableName = process.env.RESUME_VERSIONS_TABLE_NAME;

    if (!bucketName || !resumeVersionsTableName) {
      log.error("Environment variables not set", { bucketName, resumeVersionsTableName });
      return respondWithError(500, "Server configuration error.");
    }

    // Generate a presigned URL for uploading the resume
    const presignedUrl = s3.getSignedUrl("putObject", {
      Bucket: bucketName,
      Key: s3Key,
      ContentType: fileType,
      Expires: 300, // URL expires in 5 minutes
    });

    // Create a temporary resume version metadata record
    const timestamp = new Date().toISOString();
    const resumeVersionMetadata = {
      id: versionId,
      userId: userId,
      fileName: fileName,
      fileType: fileType,
      fileSize: fileSize || 0,
      s3Key: s3Key,
      title: title || fileName,
      description: description || "",
      tags: tags || [],
      status: "pending", // Will be updated to "complete" after upload
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const dynamoParams = {
      TableName: resumeVersionsTableName,
      Item: resumeVersionMetadata,
    };

    await dynamoDb.put(dynamoParams).promise();
    log.info("Resume upload initiated successfully", { versionId, userId });

    return respondWithSuccess(200, {
      versionId: versionId,
      presignedUrl: presignedUrl,
      resumeVersionMetadata: resumeVersionMetadata,
    });

  } catch (error) {
    log.error("Error initiating resume upload", { error: error.message, stack: error.stack });
    if (error instanceof SyntaxError) {
      return respondWithError(400, "Invalid JSON payload.");
    }
    return respondWithError(500, "Could not initiate resume upload. Please try again later.");
  }
};
