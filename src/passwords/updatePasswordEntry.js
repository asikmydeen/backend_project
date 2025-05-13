const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();
const kms = new AWS.KMS();

// Environment variable for the KMS Key ID
const KMS_KEY_ID = process.env.KMS_KEY_ID_PASSWORDS;

async function encryptPassword(password) {
  if (!KMS_KEY_ID) {
    log.error("KMS_KEY_ID_PASSWORDS environment variable is not set.");
    throw new Error("Server encryption configuration error.");
  }
  const params = {
    KeyId: KMS_KEY_ID,
    Plaintext: Buffer.from(password),
  };
  const { CiphertextBlob } = await kms.encrypt(params).promise();
  return CiphertextBlob.toString("base64");
}

module.exports.handler = async (event) => {
  log.info("Received request to update password entry", { pathParameters: event.pathParameters, body: event.body, eventContext: event.requestContext });

  if (!KMS_KEY_ID) {
    log.error("KMS_KEY_ID_PASSWORDS is not configured. Cannot proceed with password entry update.");
    return respondWithError(500, "Server encryption configuration error. Cannot update password entry.");
  }

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const entryId = event.pathParameters?.id;
    if (!entryId) {
      return respondWithError(400, "Password entry ID is required in the path.");
    }

    const requestBody = JSON.parse(event.body);
    const { serviceName, username, password, url, notes, category, tags, twoFactorEnabled, customFields } = requestBody;

    const passwordEntriesTableName = process.env.PASSWORD_ENTRIES_TABLE_NAME;
    if (!passwordEntriesTableName) {
      log.error("Environment variable PASSWORD_ENTRIES_TABLE_NAME is not set.");
      return respondWithError(500, "Server configuration error.");
    }

    // First, get the entry to ensure it exists and belongs to the user
    const getParams = {
      TableName: passwordEntriesTableName,
      Key: { id: entryId },
    };
    const getResult = await dynamoDb.get(getParams).promise();

    if (!getResult.Item) {
      log.warn("Password entry not found for update", { entryId, userId });
      return respondWithError(404, "Password entry not found.");
    }

    if (getResult.Item.userId !== userId) {
      log.warn("User attempted to update a password entry they do not own", { entryId, requestingUserId: userId, ownerUserId: getResult.Item.userId });
      return respondWithError(403, "Forbidden: You do not have permission to update this password entry.");
    }

    // Prepare update expression
    const timestamp = new Date().toISOString();
    let updateExpression = "SET updatedAt = :updatedAt";
    const expressionAttributeValues = { ":updatedAt": timestamp };
    const expressionAttributeNames = {}; // For reserved keywords

    if (serviceName !== undefined) {
      updateExpression += ", serviceName = :serviceName";
      expressionAttributeValues[":serviceName"] = serviceName;
    }
    if (username !== undefined) {
      updateExpression += ", username = :username";
      expressionAttributeValues[":username"] = username;
    }
    if (password !== undefined) {
      const encryptedPassword = await encryptPassword(password);
      updateExpression += ", encryptedPassword = :encryptedPassword, passwordLastChangedAt = :passwordLastChangedAt";
      expressionAttributeValues[":encryptedPassword"] = encryptedPassword;
      expressionAttributeValues[":passwordLastChangedAt"] = timestamp;
    }
    if (url !== undefined) {
      updateExpression += ", url = :url";
      expressionAttributeValues[":url"] = url;
    }
    if (notes !== undefined) {
      updateExpression += ", notes = :notes";
      expressionAttributeValues[":notes"] = notes;
    }
    if (category !== undefined) {
      updateExpression += ", category = :category";
      expressionAttributeValues[":category"] = category;
    }
    if (tags !== undefined) {
      updateExpression += ", tags = :tags";
      expressionAttributeValues[":tags"] = tags;
    }
    if (twoFactorEnabled !== undefined) {
      updateExpression += ", twoFactorEnabled = :twoFactorEnabled";
      expressionAttributeValues[":twoFactorEnabled"] = twoFactorEnabled;
    }
    if (customFields !== undefined) {
      updateExpression += ", customFields = :customFields";
      expressionAttributeValues[":customFields"] = customFields;
    }

    if (Object.keys(requestBody).length === 0) {
        // If body is empty, just update `updatedAt` (already set) or return current item
        const currentItem = { ...getResult.Item };
        delete currentItem.encryptedPassword; // Don't return encrypted password
        return respondWithSuccess(200, { message: "No fields provided for update.", entry: currentItem });
    }

    const updateParams = {
      TableName: passwordEntriesTableName,
      Key: { id: entryId },
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: "ALL_NEW", // Get all attributes of the updated item
    };
    
    if (Object.keys(expressionAttributeNames).length > 0) {
        updateParams.ExpressionAttributeNames = expressionAttributeNames;
    }

    const updatedResult = await dynamoDb.update(updateParams).promise();
    log.info("Password entry updated successfully", { entryId, userId, updatedAttributes: updatedResult.Attributes });

    // Omit encryptedPassword from the response
    const responseItem = { ...updatedResult.Attributes };
    delete responseItem.encryptedPassword;

    // TODO: Record activity (e.g., password entry updated)
    // await recordActivity(userId, "UPDATE_PASSWORD_ENTRY", { entryId, serviceName: responseItem.serviceName });

    return respondWithSuccess(200, responseItem);

  } catch (error) {
    log.error("Error updating password entry", { error: error.message, stack: error.stack });
    if (error instanceof SyntaxError) {
        return respondWithError(400, "Invalid JSON payload.");
    }
    if (error.message === "Server encryption configuration error.") {
        return respondWithError(500, error.message);
    }
    return respondWithError(500, "Could not update password entry. Please try again later.");
  }
};

