const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to create resume metadata", { body: event.body, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const requestBody = JSON.parse(event.body);
    const { versionId, status, isDefault } = requestBody;

    if (!versionId) {
      return respondWithError(400, "Version ID is required.");
    }

    const resumeVersionsTableName = process.env.RESUME_VERSIONS_TABLE_NAME;
    if (!resumeVersionsTableName) {
      log.error("Environment variable RESUME_VERSIONS_TABLE_NAME is not set.");
      return respondWithError(500, "Server configuration error.");
    }

    // Get the existing resume version metadata
    const getParams = {
      TableName: resumeVersionsTableName,
      Key: { id: versionId },
    };

    const result = await dynamoDb.get(getParams).promise();
    if (!result.Item) {
      return respondWithError(404, "Resume version metadata not found.");
    }

    const resumeVersionMetadata = result.Item;
    
    // Verify the resume version belongs to the user
    if (resumeVersionMetadata.userId !== userId) {
      return respondWithError(403, "You do not have permission to update this resume version.");
    }

    // Update the resume version metadata
    const timestamp = new Date().toISOString();
    const updateParams = {
      TableName: resumeVersionsTableName,
      Key: { id: versionId },
      UpdateExpression: "set #status = :status, updatedAt = :updatedAt",
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":status": status || "complete",
        ":updatedAt": timestamp,
      },
      ReturnValues: "ALL_NEW",
    };

    const updateResult = await dynamoDb.update(updateParams).promise();
    
    // If isDefault is true, update all other resume versions to not be default
    if (isDefault) {
      // First, get all resume versions for the user
      const queryParams = {
        TableName: resumeVersionsTableName,
        KeyConditionExpression: "userId = :userId",
        ExpressionAttributeValues: {
          ":userId": userId,
        },
      };

      const queryResult = await dynamoDb.query(queryParams).promise();
      
      // Update all other resume versions to not be default
      const updatePromises = queryResult.Items
        .filter(version => version.id !== versionId)
        .map(version => {
          const updateVersionParams = {
            TableName: resumeVersionsTableName,
            Key: { id: version.id },
            UpdateExpression: "set isDefault = :isDefault, updatedAt = :updatedAt",
            ExpressionAttributeValues: {
              ":isDefault": false,
              ":updatedAt": timestamp,
            },
          };
          return dynamoDb.update(updateVersionParams).promise();
        });

      // Update the current version to be default
      const updateDefaultParams = {
        TableName: resumeVersionsTableName,
        Key: { id: versionId },
        UpdateExpression: "set isDefault = :isDefault, updatedAt = :updatedAt",
        ExpressionAttributeValues: {
          ":isDefault": true,
          ":updatedAt": timestamp,
        },
        ReturnValues: "ALL_NEW",
      };

      await Promise.all([...updatePromises, dynamoDb.update(updateDefaultParams).promise()]);
    }

    log.info("Resume metadata created successfully", { versionId, userId });

    return respondWithSuccess(200, updateResult.Attributes);

  } catch (error) {
    log.error("Error creating resume metadata", { error: error.message, stack: error.stack });
    if (error instanceof SyntaxError) {
      return respondWithError(400, "Invalid JSON payload.");
    }
    return respondWithError(500, "Could not create resume metadata. Please try again later.");
  }
};
