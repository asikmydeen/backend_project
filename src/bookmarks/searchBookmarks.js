const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to search bookmarks", { queryStringParameters: event.queryStringParameters, eventContext: event.requestContext });

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

    const query = event.queryStringParameters?.q?.toLowerCase();
    if (!query) {
      return respondWithError(400, "Search query parameter 'q' is required.");
    }

    // Fetch all bookmarks for the user and filter in Lambda.
    // This is NOT scalable for large datasets. Consider OpenSearch for better search capabilities.
    const userBookmarksParams = {
        TableName: bookmarksTableName,
        IndexName: bookmarksUserIdGsiName,
        KeyConditionExpression: "userId = :userId",
        ExpressionAttributeValues: { ":userId": userId },
    };

    const result = await dynamoDb.query(userBookmarksParams).promise();
    let items = result.Items || [];

    const searchResults = items.filter(bookmark => {
        const titleMatch = bookmark.title && bookmark.title.toLowerCase().includes(query);
        const descriptionMatch = bookmark.description && bookmark.description.toLowerCase().includes(query);
        const urlMatch = bookmark.url && bookmark.url.toLowerCase().includes(query);
        const categoryMatch = bookmark.category && bookmark.category.toLowerCase().includes(query);
        const tagMatch = bookmark.tags && Array.isArray(bookmark.tags) && bookmark.tags.some(tag => tag.toLowerCase().includes(query));
        return titleMatch || descriptionMatch || urlMatch || categoryMatch || tagMatch;
    });

    log.info("Bookmarks searched successfully", { userId, query, count: searchResults.length });
    return respondWithSuccess(200, searchResults);

  } catch (error) {
    log.error("Error searching bookmarks", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not search bookmarks. Please try again later.");
  }
};

