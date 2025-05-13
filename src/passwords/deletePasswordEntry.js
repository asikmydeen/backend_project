const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

// KMS is not needed for delete operation.

module.exports.handler = async (event) => {
  log.info("Received request to delete password entry", { pathParameters: event.pathParameters, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const entryId = event.pathParameters?.id;
    if (!entryId) {
      return respondWithError(400, "Password entry ID is required in the path.");
    }

    const passwordEntriesTableName = process.env.PASSWORD_ENTRIES_TABLE_NAME;
    if (!passwordEntriesTableName) {
      log.error("Environment variable PASSWORD_ENTRIES_TABLE_NAME is not set.");
      return respondWithError(500, "Server configuration error.");
    }

    // First, get the entry to ensure it exists and belongs to the user before deleting
    const getParams = {
      TableName: passwordEntriesTableName,
      Key: {
        id: entryId,
      },
      // We only need to check userId, no need to retrieve encryptedPassword
      ProjectionExpression: "id, userId", 
    };

    const getResult = await dynamoDb.get(getParams).promise();

    if (!getResult.Item) {
      log.warn("Password entry not found for deletion", { entryId, userId });
      return respondWithError(404, "Password entry not found.");
    }

    if (getResult.Item.userId !== userId) {
      log.warn("User attempted to delete a password entry they do not own", { entryId, requestingUserId: userId, ownerUserId: getResult.Item.userId });
      return respondWithError(403, "Forbidden: You do not have permission to delete this password entry.");
    }

    // Delete the entry
    const deleteParams = {
      TableName: passwordEntriesTableName,
      Key: {
        id: entryId,
      },
    };

    await dynamoDb.delete(deleteParams).promise();
    log.info("Password entry deleted successfully", { entryId, userId });

    // TODO: Record activity (e.g., password entry deleted)
    // await recordActivity(userId, "DELETE_PASSWORD_ENTRY", { entryId, serviceName: getResult.Item.serviceName || 'N/A' });

    return respondWithSuccess(204, { message: "Password entry deleted successfully." }); // 204 No Content for successful deletion

  } catch (error) {
    log.error("Error deleting password entry", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not delete password entry. Please try again later.");
  }
};

