const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3();

module.exports.handler = async (event) => {
  log.info("Received request to get default resume", { eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const resumeVersionsTableName = process.env.RESUME_VERSIONS_TABLE_NAME;
    const bucketName = process.env.RESUMES_BUCKET_NAME;
    
    if (!resumeVersionsTableName || !bucketName) {
      log.error("Environment variables not set", { resumeVersionsTableName, bucketName });
      return respondWithError(500, "Server configuration error.");
    }

    // Find the default resume version for the user
    const queryParams = {
      TableName: resumeVersionsTableName,
      KeyConditionExpression: "userId = :userId",
      FilterExpression: "isDefault = :isDefault",
      ExpressionAttributeValues: {
        ":userId": userId,
        ":isDefault": true,
      },
    };

    const queryResult = await dynamoDb.query(queryParams).promise();
    
    // If no default resume is found, try to get the most recent one
    if (queryResult.Items.length === 0) {
      const allVersionsParams = {
        TableName: resumeVersionsTableName,
        KeyConditionExpression: "userId = :userId",
        ExpressionAttributeValues: {
          ":userId": userId,
        },
        ScanIndexForward: false, // Sort by createdAt in descending order (newest first)
        Limit: 1,
      };

      const allVersionsResult = await dynamoDb.query(allVersionsParams).promise();
      if (allVersionsResult.Items.length === 0) {
        return respondWithError(404, "No resume versions found.");
      }

      const resumeVersionMetadata = allVersionsResult.Items[0];
      
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
        isDefault: false,
      };

      log.info("Most recent resume version retrieved successfully", { versionId: resumeVersionMetadata.id, userId });
      return respondWithSuccess(200, response);
    }

    // Default resume found
    const resumeVersionMetadata = queryResult.Items[0];
    
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

    log.info("Default resume version retrieved successfully", { versionId: resumeVersionMetadata.id, userId });
    return respondWithSuccess(200, response);

  } catch (error) {
    log.error("Error getting default resume", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not get default resume. Please try again later.");
  }
};
