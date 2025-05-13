const AWS = require("aws-sdk");
const { v4: uuidv4 } = require("uuid");
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
  return CiphertextBlob.toString("base64"); // Store as base64 string
}

module.exports.handler = async (event) => {
  log.info("Received request to create password entry", { body: event.body, eventContext: event.requestContext });

  if (!KMS_KEY_ID) {
    log.error("KMS_KEY_ID_PASSWORDS is not configured. Cannot proceed with password entry creation.");
    return respondWithError(500, "Server encryption configuration error. Cannot create password entry.");
  }

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const requestBody = JSON.parse(event.body);
    const { serviceName, username, password, url, notes, category, tags, twoFactorEnabled, customFields } = requestBody;

    if (!serviceName || !username || !password) {
      return respondWithError(400, "Service name, username, and password are required.");
    }

    const passwordEntriesTableName = process.env.PASSWORD_ENTRIES_TABLE_NAME;
    if (!passwordEntriesTableName) {
      log.error("Environment variable PASSWORD_ENTRIES_TABLE_NAME is not set.");
      return respondWithError(500, "Server configuration error.");
    }

    const encryptedPassword = await encryptPassword(password);

    const timestamp = new Date().toISOString();
    const entryId = uuidv4();

    const passwordEntryItem = {
      id: entryId,
      userId: userId,
      serviceName: serviceName,
      username: username,
      encryptedPassword: encryptedPassword, // Store encrypted password
      url: url || "",
      notes: notes || "",
      category: category || "general",
      tags: tags || [],
      twoFactorEnabled: twoFactorEnabled || false,
      customFields: customFields || [], // Expecting an array of {name: string, value: string, type: 'text'|'password' (client hints)}
      createdAt: timestamp,
      updatedAt: timestamp,
      passwordLastChangedAt: timestamp, // Initialize password last changed timestamp
    };

    const dynamoParams = {
      TableName: passwordEntriesTableName,
      Item: passwordEntryItem,
    };

    await dynamoDb.put(dynamoParams).promise();
    log.info("Password entry created successfully", { entryId, userId });

    // TODO: Record activity (e.g., password entry created, but not the password itself)
    // await recordActivity(userId, "CREATE_PASSWORD_ENTRY", { entryId, serviceName });

    // Omit encryptedPassword from the response for security, or return a confirmation message.
    const responseItem = { ...passwordEntryItem };
    delete responseItem.encryptedPassword; // Do not return the encrypted password

    return respondWithSuccess(201, responseItem);

  } catch (error) {
    log.error("Error creating password entry", { error: error.message, stack: error.stack });
    if (error instanceof SyntaxError) {
        return respondWithError(400, "Invalid JSON payload.");
    }
    if (error.message === "Server encryption configuration error.") {
        return respondWithError(500, error.message);
    }
    return respondWithError(500, "Could not create password entry. Please try again later.");
  }
};

