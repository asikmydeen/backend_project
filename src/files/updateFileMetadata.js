const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to update file metadata", { pathParameters: event.pathParameters, body: event.body, eventContext: event.requestContext });

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
    if (!filesTableName) {
      log.error("Environment variable FILES_TABLE_NAME is not set.");
      return respondWithError(500, "Server configuration error.");
    }

    // Get the existing file metadata
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
      return respondWithError(403, "You do not have permission to update this file.");
    }

    const requestBody = JSON.parse(event.body);
    const { fileName, folderId, description, tags } = requestBody;

    // Build update expression and attribute values
    let updateExpression = "set updatedAt = :updatedAt";
    const expressionAttributeValues = {
      ":updatedAt": new Date().toISOString(),
    };

    if (fileName) {
      updateExpression += ", fileName = :fileName";
      expressionAttributeValues[":fileName"] = fileName;
    }

    if (folderId !== undefined) {
      updateExpression += ", folderId = :folderId";
      expressionAttributeValues[":folderId"] = folderId || null;
    }

    if (description !== undefined) {
      updateExpression += ", description = :description";
      expressionAttributeValues[":description"] = description || "";
    }

    if (tags !== undefined) {
      updateExpression += ", tags = :tags";
      expressionAttributeValues[":tags"] = tags || [];
    }

    const updateParams = {
      TableName: filesTableName,
      Key: { id: fileId },
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: "ALL_NEW",
    };

    const updateResult = await dynamoDb.update(updateParams).promise();
    log.info("File metadata updated successfully", { fileId, userId });

    return respondWithSuccess(200, updateResult.Attributes);

  } catch (error) {
    log.error("Error updating file metadata", { error: error.message, stack: error.stack });
    if (error instanceof SyntaxError) {
      return respondWithError(400, "Invalid JSON payload.");
    }
    return respondWithError(500, "Could not update file metadata. Please try again later.");
  }
};
