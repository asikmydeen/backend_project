const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to update bookmark", { pathParameters: event.pathParameters, body: event.body, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const bookmarkId = event.pathParameters?.id;
    if (!bookmarkId) {
      return respondWithError(400, "Bookmark ID is required in the path.");
    }

    const requestBody = JSON.parse(event.body);
    const { url, title, description, tags, category, favicon, folderId } = requestBody;

    const bookmarksTableName = process.env.BOOKMARKS_TABLE_NAME;
    if (!bookmarksTableName) {
      log.error("Environment variable BOOKMARKS_TABLE_NAME is not set.");
      return respondWithError(500, "Server configuration error.");
    }

    // First, get the bookmark to ensure it exists and belongs to the user
    const getParams = {
      TableName: bookmarksTableName,
      Key: { id: bookmarkId },
    };
    const getResult = await dynamoDb.get(getParams).promise();

    if (!getResult.Item) {
      log.warn("Bookmark not found for update", { bookmarkId, userId });
      return respondWithError(404, "Bookmark not found.");
    }

    if (getResult.Item.userId !== userId) {
      log.warn("User attempted to update a bookmark they do not own", { bookmarkId, requestingUserId: userId, ownerUserId: getResult.Item.userId });
      return respondWithError(403, "Forbidden: You do not have permission to update this bookmark.");
    }

    // Prepare update expression
    const timestamp = new Date().toISOString();
    let updateExpression = "SET updatedAt = :updatedAt";
    const expressionAttributeValues = { ":updatedAt": timestamp };

    if (url !== undefined) {
      updateExpression += ", url = :url";
      expressionAttributeValues[":url"] = url;
    }
    if (title !== undefined) {
      updateExpression += ", title = :title";
      expressionAttributeValues[":title"] = title;
    }
    if (description !== undefined) {
      updateExpression += ", description = :description";
      expressionAttributeValues[":description"] = description;
    }
    if (tags !== undefined) {
      updateExpression += ", tags = :tags";
      expressionAttributeValues[":tags"] = tags;
    }
    if (category !== undefined) {
      updateExpression += ", category = :category";
      expressionAttributeValues[":category"] = category;
    }
    if (favicon !== undefined) {
      updateExpression += ", favicon = :favicon";
      expressionAttributeValues[":favicon"] = favicon;
    }
    if (folderId !== undefined) { // Allows moving to a folder or to root (null)
        updateExpression += ", folderId = :folderId";
        expressionAttributeValues[":folderId"] = folderId; // folderId can be null
    }

    if (Object.keys(requestBody).length === 0) {
        return respondWithSuccess(200, { message: "No fields provided for update.", bookmark: getResult.Item });
    }

    const updateParams = {
      TableName: bookmarksTableName,
      Key: { id: bookmarkId },
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: "UPDATED_NEW",
    };

    const updatedResult = await dynamoDb.update(updateParams).promise();
    log.info("Bookmark updated successfully", { bookmarkId, userId, updatedAttributes: updatedResult.Attributes });

    return respondWithSuccess(200, updatedResult.Attributes);

  } catch (error) {
    log.error("Error updating bookmark", { error: error.message, stack: error.stack });
    if (error instanceof SyntaxError) { // JSON.parse error
        return respondWithError(400, "Invalid JSON payload.");
    }
    return respondWithError(500, "Could not update bookmark. Please try again later.");
  }
};

