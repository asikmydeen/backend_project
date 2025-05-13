const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

// Helper function to query all items for a user from a table using a GSI
async function getAllUserItems(tableName, indexName, userId, tagAttributeName, projectionExpression) {
    let allItems = [];
    let lastEvaluatedKey = null;

    do {
        const params = {
            TableName: tableName,
            IndexName: indexName,
            KeyConditionExpression: "userId = :userId",
            ExpressionAttributeValues: { ":userId": userId },
            ProjectionExpression: projectionExpression, // e.g., "id, #tagsAttr"
            ExclusiveStartKey: lastEvaluatedKey,
        };
        if (tagAttributeName) {
            params.ExpressionAttributeNames = { "#tagsAttr": tagAttributeName };
        }

        try {
            const result = await dynamoDb.query(params).promise();
            if (result.Items) {
                allItems = allItems.concat(result.Items);
            }
            lastEvaluatedKey = result.LastEvaluatedKey;
        } catch (error) {
            log.error(`Error querying table ${tableName} for user ${userId}`, { error: error.message });
            // Depending on desired behavior, either throw or return partial results/empty
            throw new Error(`Failed to query ${tableName}`); 
        }
    } while (lastEvaluatedKey);

    return allItems;
}

module.exports.handler = async (event) => {
  log.info("Received request to list all unique tags for the user", { eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const allTags = new Set();

    // Define tables and their configurations for fetching tags
    // This list should be expanded as more entities support tags
    const taggedResourceConfigs = [
      {
        tableNameEnvVar: "NOTES_TABLE_NAME",
        gsiNameEnvVar: "NOTES_BY_USER_ID_GSI_NAME",
        tagAttribute: "tags", // Assumes 'tags' is an array of strings
        projection: "id, #tagsAttr",
      },
      {
        tableNameEnvVar: "BOOKMARKS_TABLE_NAME",
        gsiNameEnvVar: "BOOKMARKS_BY_USER_ID_GSI_NAME",
        tagAttribute: "tags",
        projection: "id, #tagsAttr",
      },
      {
        tableNameEnvVar: "PHOTOS_TABLE_NAME",
        gsiNameEnvVar: "PHOTOS_BY_USER_ID_GSI_NAME", // Assuming similar GSI exists
        tagAttribute: "tags",
        projection: "id, #tagsAttr",
      },
      {
        tableNameEnvVar: "FILES_TABLE_NAME",
        gsiNameEnvVar: "FILES_BY_USER_ID_GSI_NAME", // Assuming similar GSI exists
        tagAttribute: "tags",
        projection: "id, #tagsAttr",
      },
      {
        tableNameEnvVar: "VOICE_MEMOS_TABLE_NAME",
        gsiNameEnvVar: "VOICE_MEMOS_BY_USER_ID_GSI_NAME", // Assuming similar GSI exists
        tagAttribute: "tags",
        projection: "id, #tagsAttr",
      },
      // Add other resources like Albums, etc., if they support tags
    ];

    for (const config of taggedResourceConfigs) {
      const tableName = process.env[config.tableNameEnvVar];
      const gsiName = process.env[config.gsiNameEnvVar];

      if (tableName && gsiName) {
        try {
          const items = await getAllUserItems(tableName, gsiName, userId, config.tagAttribute, config.projection);
          items.forEach(item => {
            const tags = item[config.tagAttribute];
            if (Array.isArray(tags)) {
              tags.forEach(tag => {
                if (typeof tag === 'string' && tag.trim() !== '') {
                  allTags.add(tag.trim());
                }
              });
            }
          });
        } catch (queryError) {
          log.warn(`Could not retrieve tags from ${tableName} for user ${userId}`, { error: queryError.message });
          // Continue to next table if one fails, or decide to error out globally
        }
      }
    }

    const uniqueTagsArray = Array.from(allTags).sort(); // Sort alphabetically

    log.info(`Unique tags retrieved for user ${userId}`, { count: uniqueTagsArray.length });
    return respondWithSuccess(200, uniqueTagsArray);

  } catch (error) {
    log.error("Error listing unique tags", { error: error.message, stack: error.stack });
    if (error.message.startsWith("Failed to query")) {
        return respondWithError(500, "Error retrieving tags from one or more resources.");
    }
    return respondWithError(500, "Could not list unique tags. Please try again later.");
  }
};

