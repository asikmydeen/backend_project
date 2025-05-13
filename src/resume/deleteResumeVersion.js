const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3();

module.exports.handler = async (event) => {
  log.info("Received request to delete resume version", { pathParameters: event.pathParameters, eventContext: event.requestContext });

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

    // Get the resume version metadata to verify ownership and get the S3 key
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
      return respondWithError(403, "You do not have permission to delete this resume version.");
    }

    // Check if this is the default version
    if (resumeVersionMetadata.isDefault) {
      // Find another version to set as default
      const queryParams = {
        TableName: resumeVersionsTableName,
        KeyConditionExpression: "userId = :userId",
        FilterExpression: "id <> :versionId",
        ExpressionAttributeValues: {
          ":userId": userId,
          ":versionId": versionId,
        },
        Limit: 1,
      };

      const queryResult = await dynamoDb.query(queryParams).promise();
      
      if (queryResult.Items.length > 0) {
        // Set another version as default
        const newDefaultVersionId = queryResult.Items[0].id;
        const updateDefaultParams = {
          TableName: resumeVersionsTableName,
          Key: { id: newDefaultVersionId },
          UpdateExpression: "set isDefault = :isDefault, updatedAt = :updatedAt",
          ExpressionAttributeValues: {
            ":isDefault": true,
            ":updatedAt": new Date().toISOString(),
          },
        };

        await dynamoDb.update(updateDefaultParams).promise();
        log.info("New default resume version set", { newDefaultVersionId, userId });
      }
    }

    // Delete the resume version from S3
    const s3Params = {
      Bucket: bucketName,
      Key: resumeVersionMetadata.s3Key,
    };

    await s3.deleteObject(s3Params).promise();

    // Delete the resume version metadata from DynamoDB
    const deleteParams = {
      TableName: resumeVersionsTableName,
      Key: { id: versionId },
    };

    await dynamoDb.delete(deleteParams).promise();
    log.info("Resume version deleted successfully", { versionId, userId });

    return respondWithSuccess(200, { message: "Resume version deleted successfully" });

  } catch (error) {
    log.error("Error deleting resume version", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not delete resume version. Please try again later.");
  }
};
