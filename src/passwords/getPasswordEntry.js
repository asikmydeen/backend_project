const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();
const kms = new AWS.KMS();

// Environment variable for the KMS Key ID
const KMS_KEY_ID = process.env.KMS_KEY_ID_PASSWORDS;

async function decryptPassword(encryptedPassword) {
  if (!KMS_KEY_ID) {
    log.error("KMS_KEY_ID_PASSWORDS environment variable is not set.");
    throw new Error("Server decryption configuration error.");
  }
  try {
    const params = {
      CiphertextBlob: Buffer.from(encryptedPassword, "base64"),
    };
    const { Plaintext } = await kms.decrypt(params).promise();
    return Plaintext.toString();
  } catch (error) {
    log.error("KMS decryption failed", { error: error.message });
    // Check if the error is due to an invalid ciphertext, which might happen if the key is wrong or data is corrupt
    if (error.code === 'InvalidCiphertextException' || error.code === 'AccessDeniedException') {
        throw new Error("Failed to decrypt password. Ensure correct key and data.");
    }    
    throw new Error("Server decryption error."); // General decryption error
  }
}

module.exports.handler = async (event) => {
  log.info("Received request to get password entry", { pathParameters: event.pathParameters, eventContext: event.requestContext });

  if (!KMS_KEY_ID) {
    log.error("KMS_KEY_ID_PASSWORDS is not configured. Cannot proceed with getting password entry.");
    return respondWithError(500, "Server encryption configuration error. Cannot retrieve password entry.");
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
    };

    const result = await dynamoDb.get(dynamoParams).promise();

    if (!result.Item) {
      log.warn("Password entry not found", { entryId, userId });
      return respondWithError(404, "Password entry not found.");
    }

    // Verify that the entry belongs to the requesting user
    if (result.Item.userId !== userId) {
      log.warn("User attempted to access a password entry they do not own", { entryId, requestingUserId: userId, ownerUserId: result.Item.userId });
      return respondWithError(403, "Forbidden: You do not have permission to access this password entry.");
    }

    const entry = result.Item;
    let decryptedPassword = null;
    if (entry.encryptedPassword) {
        try {
            decryptedPassword = await decryptPassword(entry.encryptedPassword);
        } catch (decryptionError) {
            log.error("Failed to decrypt password for entry", { entryId, userId, error: decryptionError.message });
            // Decide if to return the entry without password or an error
            // For security, if decryption fails, it's a server-side issue or data integrity problem.
            return respondWithError(500, "Failed to retrieve password details due to a decryption error.");
        }
    }

    // Prepare response, replacing encryptedPassword with decryptedPassword
    const responseItem = { ...entry };
    delete responseItem.encryptedPassword; // Remove encrypted version
    if (decryptedPassword !== null) {
        responseItem.password = decryptedPassword; // Add decrypted version
    }

    log.info("Password entry retrieved and decrypted successfully", { entryId, userId });
    return respondWithSuccess(200, responseItem);

  } catch (error) {
    log.error("Error getting password entry", { error: error.message, stack: error.stack });
    if (error.message.startsWith("Server decryption configuration error") || error.message.startsWith("Failed to decrypt password")) {
        return respondWithError(500, error.message);
    }
    return respondWithError(500, "Could not retrieve password entry. Please try again later.");
  }
};

