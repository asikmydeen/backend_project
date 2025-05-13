const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to search notes", { queryStringParameters: event.queryStringParameters, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const notesTableName = process.env.NOTES_TABLE_NAME;
    const notesUserIdGsiName = process.env.NOTES_USER_ID_GSI_NAME; // e.g., "UserIdCreatedAtGSI"

    if (!notesTableName || !notesUserIdGsiName) {
      log.error("Environment variables NOTES_TABLE_NAME or NOTES_USER_ID_GSI_NAME are not set.");
      return respondWithError(500, "Server configuration error.");
    }

    const query = event.queryStringParameters?.q?.toLowerCase();
    if (!query) {
      return respondWithError(400, "Search query parameter 'q' is required.");
    }

    // DynamoDB Scan or Query on GSI + Filter
    // A full-text search solution like OpenSearch/Elasticsearch would be better for complex search.
    // For DynamoDB, we can filter on title, content, and tags (if stored as a list of strings).

    const dynamoParams = {
      TableName: notesTableName,
      IndexName: notesUserIdGsiName, // Querying on the GSI for userId
      KeyConditionExpression: "userId = :userId",
      FilterExpression: "contains(title_lowercase, :query) OR contains(content_lowercase, :query) OR contains(tags_lowercase, :query_tag)",
      // We need to store lowercase versions of title, content, and tags for case-insensitive search, or handle it in lambda.
      // For simplicity, assuming attributes like title_lowercase, content_lowercase, tags_lowercase exist.
      // If not, this scan will be case-sensitive or we need to fetch all and filter in lambda (inefficient).
      // A better approach for tags would be to check if the query term is IN the tags list.
      // Let's refine FilterExpression for better tag search and assuming we create lowercase fields or handle it.
      // For now, this is a simplified search. A more robust solution would involve creating dedicated search indices or attributes.

      // A more practical filter for DynamoDB without dedicated lowercase fields (less efficient):
      // FilterExpression: "(contains(title, :query) OR contains(content, :query) OR (attribute_exists(tags) AND list_contains(tags, :query_tag)) )",
      // This is still limited. For true case-insensitive search on existing fields, a Scan + Lambda filter is needed.
      // Let's assume we will fetch all user's notes and filter in Lambda for simplicity of this example, though not scalable.
      ExpressionAttributeValues: {
        ":userId": userId,
        // ":query": query, // This would be for contains on original fields
        // ":query_tag": query // If searching for a whole tag
      },
    };
    
    // Due to DynamoDB limitations for partial, case-insensitive search, 
    // we will fetch all notes for the user and filter in the Lambda.
    // This is NOT recommended for large datasets.
    const userNotesParams = {
        TableName: notesTableName,
        IndexName: notesUserIdGsiName,
        KeyConditionExpression: "userId = :userId",
        ExpressionAttributeValues: { ":userId": userId },
    };

    const result = await dynamoDb.query(userNotesParams).promise();
    let items = result.Items || [];

    const searchResults = items.filter(note => {
        const titleMatch = note.title && note.title.toLowerCase().includes(query);
        const contentMatch = note.content && note.content.toLowerCase().includes(query);
        const tagMatch = note.tags && Array.isArray(note.tags) && note.tags.some(tag => tag.toLowerCase().includes(query));
        return titleMatch || contentMatch || tagMatch;
    });

    log.info("Notes searched successfully", { userId, query, count: searchResults.length });
    return respondWithSuccess(200, searchResults);

  } catch (error) {
    log.error("Error searching notes", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not search notes. Please try again later.");
  }
};

