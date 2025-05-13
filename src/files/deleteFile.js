const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const s3 = new AWS.S3();
const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to delete file", { pathParameters: event.pathParameters, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const { fileId } = event.pathParameters;
    if (!fileId) {
      return respondWithError(400, "File ID is required.");
    }

    const filesTableName = process.env.FILES_TABLE_NAME;
    const bucketName = process.env.FILES_BUCKET_NAME;
    
    if (!filesTableName || !bucketName) {
      log.error("Environment variables not set", { filesTableName, bucketName });
      return respondWithError(500, "Server configuration error.");
    }

    // Get the file metadata to verify ownership and get the S3 key
    const getParams = {
      TableName: filesTableName,
      Key: { id: fileId },
    };

    const result = await dynamoDb.get(getParams).promise();
    if (!result.Item) {
      return respondWithError(404, "File not found.");
    }

    const fileMetadata = result.Item;
    
    // Verify the file belongs to the user
    if (fileMetadata.userId !== userId) {
      return respondWithError(403, "You do not have permission to delete this file.");
    }

    // Delete the file from S3
    const s3Params = {
      Bucket: bucketName,
      Key: fileMetadata.s3Key,
    };

    await s3.deleteObject(s3Params).promise();

    // Delete the file metadata from DynamoDB
    const deleteParams = {
      TableName: filesTableName,
      Key: { id: fileId },
    };

    await dynamoDb.delete(deleteParams).promise();
    log.info("File deleted successfully", { fileId, userId });

    return respondWithSuccess(200, { message: "File deleted successfully" });

  } catch (error) {
    log.error("Error deleting file", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not delete file. Please try again later.");
  }
};
