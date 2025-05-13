const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to list notes by tag", { queryStringParameters: event.queryStringParameters, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const notesTableName = process.env.NOTES_TABLE_NAME;
    // This GSI should be on `userId` (Partition Key) and `tags` (Sort Key) or just `tags` if it's a global GSI.
    // However, DynamoDB doesn't directly support querying for items where a list attribute *contains* a specific value in a GSI sort key.
    // A common pattern is to have a GSI like `userId-tag-index` where `tag` is a single tag, meaning you might need to denormalize tags or use a different strategy.
    // For this example, we'll assume a GSI on `userId` and then filter by tags in the Lambda, which is not ideal for performance with many tags/notes.
    // A better DynamoDB-native approach for many-to-many (note-to-tag) is an adjacency list or a separate Tags table.
    // Let's use the existing NOTES_USER_ID_GSI_NAME and filter in Lambda.
    const notesUserIdGsiName = process.env.NOTES_USER_ID_GSI_NAME;

    if (!notesTableName || !notesUserIdGsiName) {
      log.error("Environment variables NOTES_TABLE_NAME or NOTES_USER_ID_GSI_NAME are not set.");
      return respondWithError(500, "Server configuration error.");
    }

    const tagsQuery = event.queryStringParameters?.tags_like;
    if (!tagsQuery) {
      return respondWithError(400, "tags_like query parameter is required.");
    }
    // Assuming tags_like is a comma-separated string of tags to match (any of them)
    const targetTags = tagsQuery.toLowerCase().split(',').map(tag => tag.trim()).filter(tag => tag);

    if (targetTags.length === 0) {
        return respondWithError(400, "At least one tag must be provided in tags_like parameter.");
    }

    // Fetch all notes for the user and then filter by tags.
    // This is NOT scalable for large datasets. A proper GSI strategy for tags is crucial.
    const userNotesParams = {
        TableName: notesTableName,
        IndexName: notesUserIdGsiName,
        KeyConditionExpression: "userId = :userId",
        ExpressionAttributeValues: { ":userId": userId },
    };

    const result = await dynamoDb.query(userNotesParams).promise();
    let items = result.Items || [];

    const filteredResults = items.filter(note => {
        if (note.tags && Array.isArray(note.tags)) {
            // Check if any of the note's tags (case-insensitive) are in the targetTags list
            return note.tags.some(noteTag => targetTags.includes(noteTag.toLowerCase()));
        }
        return false;
    });

    log.info("Notes listed by tag successfully", { userId, tagsQuery, count: filteredResults.length });
    return respondWithSuccess(200, filteredResults);

  } catch (error) {
    log.error("Error listing notes by tag", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not list notes by tag. Please try again later.");
  }
};

