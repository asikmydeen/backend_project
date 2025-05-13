const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3();

module.exports.handler = async (event) => {
  log.info("Received request to get resume version", { pathParameters: event.pathParameters, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const { versionId } = event.pathParameters;
    if (!versionId) {
      return respondWithError(400, "Version ID is required.");
    }

    const resumeVersionsTableName = process.env.RESUME_VERSIONS_TABLE_NAME;
    const bucketName = process.env.RESUMES_BUCKET_NAME;
    
    if (!resumeVersionsTableName || !bucketName) {
      log.error("Environment variables not set", { resumeVersionsTableName, bucketName });
      return respondWithError(500, "Server configuration error.");
    }

    // Get the resume version metadata
    const getParams = {
      TableName: resumeVersionsTableName,
      Key: { id: versionId },
    };

    const result = await dynamoDb.get(getParams).promise();
    if (!result.Item) {
      return respondWithError(404, "Resume version not found.");
    }

    const resumeVersionMetadata = result.Item;
    
    // Verify the resume version belongs to the user
    if (resumeVersionMetadata.userId !== userId) {
      return respondWithError(403, "You do not have permission to access this resume version.");
    }

    // Generate a presigned URL for viewing the resume
    const presignedUrl = s3.getSignedUrl("getObject", {
      Bucket: bucketName,
      Key: resumeVersionMetadata.s3Key,
      Expires: 3600, // URL expires in 1 hour
    });

    // Add the presigned URL to the response
    const response = {
      ...resumeVersionMetadata,
      presignedUrl: presignedUrl,
    };

    log.info("Resume version retrieved successfully", { versionId, userId });
    return respondWithSuccess(200, response);

  } catch (error) {
    log.error("Error getting resume version", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not get resume version. Please try again later.");
  }
};
