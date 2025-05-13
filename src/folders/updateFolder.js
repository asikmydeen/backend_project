const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to update folder", { pathParameters: event.pathParameters, body: event.body, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const { folderId } = event.pathParameters;
    if (!folderId) {
      return respondWithError(400, "Folder ID is required.");
    }

    const foldersTableName = process.env.FOLDERS_TABLE_NAME;
    if (!foldersTableName) {
      log.error("Environment variable FOLDERS_TABLE_NAME is not set.");
      return respondWithError(500, "Server configuration error.");
    }

    // Get the existing folder
    const getParams = {
      TableName: foldersTableName,
      Key: { id: folderId },
    };

    const result = await dynamoDb.get(getParams).promise();
    if (!result.Item) {
      return respondWithError(404, "Folder not found.");
    }

    const folder = result.Item;
    
    // Verify the folder belongs to the user
    if (folder.userId !== userId) {
      return respondWithError(403, "You do not have permission to update this folder.");
    }

    const requestBody = JSON.parse(event.body);
    const { name, parentFolderId, description } = requestBody;

    // Validate name if provided
    if (name !== undefined && !name) {
      return respondWithError(400, "Folder name cannot be empty.");
    }

    // If parentFolderId is provided, verify it exists and belongs to the user
    if (parentFolderId !== undefined && parentFolderId !== null) {
      // Prevent circular references
      if (parentFolderId === folderId) {
        return respondWithError(400, "A folder cannot be its own parent.");
      }

      const parentParams = {
        TableName: foldersTableName,
        Key: { id: parentFolderId },
      };

      const parentResult = await dynamoDb.get(parentParams).promise();
      if (!parentResult.Item) {
        return respondWithError(404, "Parent folder not found.");
      }

      if (parentResult.Item.userId !== userId) {
        return respondWithError(403, "You do not have permission to move to this parent folder.");
      }
    }

    // Build update expression and attribute values
    let updateExpression = "set updatedAt = :updatedAt";
    const expressionAttributeValues = {
      ":updatedAt": new Date().toISOString(),
    };

    if (name !== undefined) {
      updateExpression += ", #name = :name";
      expressionAttributeValues[":name"] = name;
    }

    if (parentFolderId !== undefined) {
      updateExpression += ", parentFolderId = :parentFolderId";
      expressionAttributeValues[":parentFolderId"] = parentFolderId;
    }

    if (description !== undefined) {
      updateExpression += ", description = :description";
      expressionAttributeValues[":description"] = description;
    }

    const updateParams = {
      TableName: foldersTableName,
      Key: { id: folderId },
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ExpressionAttributeNames: {
        "#name": "name", // name is a reserved word in DynamoDB
      },
      ReturnValues: "ALL_NEW",
    };

    const updateResult = await dynamoDb.update(updateParams).promise();
    log.info("Folder updated successfully", { folderId, userId });

    return respondWithSuccess(200, updateResult.Attributes);

  } catch (error) {
    log.error("Error updating folder", { error: error.message, stack: error.stack });
    if (error instanceof SyntaxError) {
      return respondWithError(400, "Invalid JSON payload.");
    }
    return respondWithError(500, "Could not update folder. Please try again later.");
  }
};
