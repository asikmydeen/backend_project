const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to list bookmarks by tag", { queryStringParameters: event.queryStringParameters, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const bookmarksTableName = process.env.BOOKMARKS_TABLE_NAME;
    const bookmarksUserIdGsiName = process.env.BOOKMARKS_USER_ID_GSI_NAME;

    if (!bookmarksTableName || !bookmarksUserIdGsiName) {
      log.error("Environment variables BOOKMARKS_TABLE_NAME or BOOKMARKS_USER_ID_GSI_NAME are not set.");
      return respondWithError(500, "Server configuration error.");
    }

    const tagsQuery = event.queryStringParameters?.tags_like;
    if (!tagsQuery) {
      return respondWithError(400, "tags_like query parameter is required.");
    }
    const targetTags = tagsQuery.toLowerCase().split(",").map(tag => tag.trim()).filter(tag => tag);

    if (targetTags.length === 0) {
        return respondWithError(400, "At least one tag must be provided in tags_like parameter.");
    }

    // Fetch all bookmarks for the user and then filter by tags.
    // This is NOT scalable for large datasets. A proper GSI strategy for tags is crucial.
    const userBookmarksParams = {
        TableName: bookmarksTableName,
        IndexName: bookmarksUserIdGsiName,
        KeyConditionExpression: "userId = :userId",
        ExpressionAttributeValues: { ":userId": userId },
    };

    const result = await dynamoDb.query(userBookmarksParams).promise();
    let items = result.Items || [];

    const filteredResults = items.filter(bookmark => {
        if (bookmark.tags && Array.isArray(bookmark.tags)) {
            return bookmark.tags.some(bookmarkTag => targetTags.includes(bookmarkTag.toLowerCase()));
        }
        return false;
    });

    log.info("Bookmarks listed by tag successfully", { userId, tagsQuery, count: filteredResults.length });
    return respondWithSuccess(200, filteredResults);

  } catch (error) {
    log.error("Error listing bookmarks by tag", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not list bookmarks by tag. Please try again later.");
  }
};

