const AWS = require("aws-sdk");
const { v4: uuidv4 } = require("uuid");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to create comment", { body: event.body, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const requestBody = JSON.parse(event.body);
    const { resourceId, resourceType, content, parentCommentId } = requestBody;

    if (!resourceId || !resourceType || !content) {
      return respondWithError(400, "Resource ID, resource type, and content are required to create a comment.");
    }

    // Validate resourceType (e.g., 'photo', 'album', 'note', 'file') - can be extended
    const validResourceTypes = ["photo", "album", "note", "file", "bookmark", "voicememo"];
    if (!validResourceTypes.includes(resourceType.toLowerCase())) {
        return respondWithError(400, `Invalid resource type. Must be one of: ${validResourceTypes.join(", ")}.`);
    }

    const commentsTableName = process.env.COMMENTS_TABLE_NAME;
    if (!commentsTableName) {
      log.error("Environment variable COMMENTS_TABLE_NAME is not set.");
      return respondWithError(500, "Server configuration error.");
    }

    const timestamp = new Date().toISOString();
    const commentId = uuidv4();

    const commentItem = {
      id: commentId,
      userId: userId, // Author of the comment
      resourceId: resourceId, // ID of the item being commented on (e.g., photoId, noteId)
      resourceType: resourceType.toLowerCase(), // Type of the item (e.g., "photo", "note")
      content: content,
      parentCommentId: parentCommentId || null, // For threaded comments
      createdAt: timestamp,
      updatedAt: timestamp,
      // Add other relevant fields like likesCount, isEdited, etc. as needed
      likesCount: 0,
      isEdited: false,
    };

    const dynamoParams = {
      TableName: commentsTableName,
      Item: commentItem,
    };

    await dynamoDb.put(dynamoParams).promise();
    log.info("Comment created successfully", { commentId, userId, resourceId, resourceType });

    // TODO: Record activity (e.g., user commented on a resource)
    // await recordActivity(userId, "CREATE_COMMENT", { resourceId, resourceType, commentId });

    // TODO: Potentially send a notification to the resource owner or other relevant users
    // if (resourceOwnerId && resourceOwnerId !== userId) {
    //   await createNotification(resourceOwnerId, "NEW_COMMENT", 
    //     `You have a new comment on your ${resourceType} '${resourceTitle || resourceId}'.`, 
    //     { resourceId, resourceType, commentId, commenterId: userId });
    // }

    return respondWithSuccess(201, commentItem);

  } catch (error) {
    log.error("Error creating comment", { error: error.message, stack: error.stack });
    if (error instanceof SyntaxError) {
        return respondWithError(400, "Invalid JSON payload.");
    }
    return respondWithError(500, "Could not create comment. Please try again later.");
  }
};

