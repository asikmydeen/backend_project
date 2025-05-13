const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to update bookmark folder", { pathParameters: event.pathParameters, body: event.body, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const folderId = event.pathParameters?.id;
    if (!folderId) {
      return respondWithError(400, "Folder ID is required in the path.");
    }

    const requestBody = JSON.parse(event.body);
    const { name, parentFolderId, description } = requestBody;

    const bookmarkFoldersTableName = process.env.BOOKMARK_FOLDERS_TABLE_NAME;
    if (!bookmarkFoldersTableName) {
      log.error("Environment variable BOOKMARK_FOLDERS_TABLE_NAME is not set.");
      return respondWithError(500, "Server configuration error.");
    }

    // First, get the folder to ensure it exists and belongs to the user
    const getParams = {
      TableName: bookmarkFoldersTableName,
      Key: { id: folderId },
    };
    const getResult = await dynamoDb.get(getParams).promise();

    if (!getResult.Item) {
      log.warn("Bookmark folder not found for update", { folderId, userId });
      return respondWithError(404, "Bookmark folder not found.");
    }

    if (getResult.Item.userId !== userId) {
      log.warn("User attempted to update a bookmark folder they do not own", { folderId, requestingUserId: userId, ownerUserId: getResult.Item.userId });
      return respondWithError(403, "Forbidden: You do not have permission to update this folder.");
    }
    
    // Prevent moving a folder into itself or its own descendants (complex check, simplified here)
    if (parentFolderId === folderId) {
        return respondWithError(400, "Cannot set a folder as its own parent.");
    }

    // Prepare update expression
    const timestamp = new Date().toISOString();
    let updateExpression = "SET updatedAt = :updatedAt";
    const expressionAttributeValues = { ":updatedAt": timestamp };

    if (name !== undefined) {
      updateExpression += ", #folderName = :name"; // Using #folderName because name is a reserved keyword
      expressionAttributeValues[":name"] = name;
      expressionAttributeNames = {"#folderName": "name"};
    }
    if (parentFolderId !== undefined) { // Allows moving to another folder or to root (null)
      updateExpression += ", parentFolderId = :parentFolderId";
      expressionAttributeValues[":parentFolderId"] = parentFolderId; 
    }
    if (description !== undefined) {
      updateExpression += ", description = :description";
      expressionAttributeValues[":description"] = description;
    }

    if (Object.keys(requestBody).length === 0) {
        return respondWithSuccess(200, { message: "No fields provided for update.", folder: getResult.Item });
    }

    const updateParams = {
      TableName: bookmarkFoldersTableName,
      Key: { id: folderId },
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: "UPDATED_NEW",
    };
    
    if (expressionAttributeNames) {
        updateParams.ExpressionAttributeNames = expressionAttributeNames;
    }

    const updatedResult = await dynamoDb.update(updateParams).promise();
    log.info("Bookmark folder updated successfully", { folderId, userId, updatedAttributes: updatedResult.Attributes });

    return respondWithSuccess(200, updatedResult.Attributes);

  } catch (error) {
    log.error("Error updating bookmark folder", { error: error.message, stack: error.stack });
    if (error instanceof SyntaxError) { 
        return respondWithError(400, "Invalid JSON payload.");
    }
    return respondWithError(500, "Could not update bookmark folder. Please try again later.");
  }
};

