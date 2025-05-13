const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

// KMS is not needed for retrieving audit timestamps.

module.exports.handler = async (event) => {
  log.info("Received request to get password entry audit trail", { pathParameters: event.pathParameters, eventContext: event.requestContext });

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

    const dynamoParams = {
      TableName: passwordEntriesTableName,
      Key: {
        id: entryId,
      },
      // Select only necessary fields for audit trail + userId for verification
      ProjectionExpression: "id, userId, createdAt, updatedAt, passwordLastChangedAt, serviceName", 
    };

    const result = await dynamoDb.get(dynamoParams).promise();

    if (!result.Item) {
      log.warn("Password entry not found for audit trail", { entryId, userId });
      return respondWithError(404, "Password entry not found.");
    }

    // Verify that the entry belongs to the requesting user
    if (result.Item.userId !== userId) {
      log.warn("User attempted to access audit trail for a password entry they do not own", { entryId, requestingUserId: userId, ownerUserId: result.Item.userId });
      return respondWithError(403, "Forbidden: You do not have permission to access this audit trail.");
    }

    const auditTrail = {
      entryId: result.Item.id,
      serviceName: result.Item.serviceName, // For context
      createdAt: result.Item.createdAt,
      updatedAt: result.Item.updatedAt,
      passwordLastChangedAt: result.Item.passwordLastChangedAt,
      // Placeholder for more detailed audit events if implemented later
      events: [
        { timestamp: result.Item.createdAt, action: "ENTRY_CREATED", details: "Password entry was initially created." },
        // If passwordLastChangedAt is different from createdAt and updatedAt, it implies a password update.
        // This is a simplified interpretation.
        ...(result.Item.passwordLastChangedAt && result.Item.passwordLastChangedAt !== result.Item.createdAt && result.Item.passwordLastChangedAt === result.Item.updatedAt ? 
            [{ timestamp: result.Item.passwordLastChangedAt, action: "PASSWORD_UPDATED", details: "Password was updated." }] : []), 
        ...(result.Item.updatedAt && result.Item.updatedAt !== result.Item.createdAt && result.Item.updatedAt !== result.Item.passwordLastChangedAt ? 
            [{ timestamp: result.Item.updatedAt, action: "ENTRY_METADATA_UPDATED", details: "Password entry metadata (e.g., notes, URL) was updated." }] : []),
      ].sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp)) // Sort events chronologically
    };
    
    // If updatedAt is the same as passwordLastChangedAt, and different from createdAt, it means the last update was a password change.
    // If updatedAt is different from both createdAt and passwordLastChangedAt, it means a metadata update happened after the last password change.
    // This logic can be refined if more granular audit is needed.
    if (auditTrail.events.length === 1 && auditTrail.events[0].action === "ENTRY_CREATED" && result.Item.updatedAt !== result.Item.createdAt) {
        // If only created event exists, but updatedAt is different, it means a metadata update happened without a password change since creation.
         auditTrail.events.push({ timestamp: result.Item.updatedAt, action: "ENTRY_METADATA_UPDATED", details: "Password entry metadata was updated after creation." });
         auditTrail.events.sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));
    }


    log.info("Password entry audit trail retrieved successfully", { entryId, userId });
    return respondWithSuccess(200, auditTrail);

  } catch (error) {
    log.error("Error getting password entry audit trail", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not retrieve password entry audit trail. Please try again later.");
  }
};

