const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();
const kms = new AWS.KMS();

// Environment variable for the KMS Key ID for Wallet data
const KMS_KEY_ID_WALLET = process.env.KMS_KEY_ID_WALLET;

async function decryptData(encryptedData) {
  if (!KMS_KEY_ID_WALLET) {
    log.error("KMS_KEY_ID_WALLET environment variable is not set.");
    throw new Error("Server decryption configuration error.");
  }
  try {
    const params = {
      CiphertextBlob: Buffer.from(encryptedData, "base64"),
    };
    const { Plaintext } = await kms.decrypt(params).promise();
    return Plaintext.toString();
  } catch (error) {
    log.error("KMS decryption failed for wallet data", { error: error.message });
    if (error.code === 'InvalidCiphertextException' || error.code === 'AccessDeniedException') {
        throw new Error("Failed to decrypt card details. Ensure correct key and data.");
    }
    throw new Error("Server decryption error.");
  }
}

module.exports.handler = async (event) => {
  log.info("Received request to get wallet card", { pathParameters: event.pathParameters, eventContext: event.requestContext });

  if (!KMS_KEY_ID_WALLET) {
    log.error("KMS_KEY_ID_WALLET is not configured. Cannot proceed with getting wallet card.");
    return respondWithError(500, "Server encryption configuration error. Cannot retrieve wallet card.");
  }

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const cardId = event.pathParameters?.id;
    if (!cardId) {
      return respondWithError(400, "Wallet card ID is required in the path.");
    }

    const walletCardsTableName = process.env.WALLET_CARDS_TABLE_NAME;
    if (!walletCardsTableName) {
      log.error("Environment variable WALLET_CARDS_TABLE_NAME is not set.");
      return respondWithError(500, "Server configuration error.");
    }

    const dynamoParams = {
      TableName: walletCardsTableName,
      Key: {
        id: cardId,
      },
    };

    const result = await dynamoDb.get(dynamoParams).promise();

    if (!result.Item) {
      log.warn("Wallet card not found", { cardId, userId });
      return respondWithError(404, "Wallet card not found.");
    }

    // Verify that the card belongs to the requesting user
    if (result.Item.userId !== userId) {
      log.warn("User attempted to access a wallet card they do not own", { cardId, requestingUserId: userId, ownerUserId: result.Item.userId });
      return respondWithError(403, "Forbidden: You do not have permission to access this wallet card.");
    }

    const card = result.Item;
    let decryptedCardNumber = null;
    let decryptedCvv = null;

    if (card.encryptedCardNumber) {
        try {
            decryptedCardNumber = await decryptData(card.encryptedCardNumber);
        } catch (decryptionError) {
            log.error("Failed to decrypt card number for wallet card", { cardId, userId, error: decryptionError.message });
            return respondWithError(500, "Failed to retrieve card details due to a card number decryption error.");
        }
    }
    if (card.encryptedCvv) {
        try {
            decryptedCvv = await decryptData(card.encryptedCvv);
        } catch (decryptionError) {
            log.error("Failed to decrypt CVV for wallet card", { cardId, userId, error: decryptionError.message });
            return respondWithError(500, "Failed to retrieve card details due to a CVV decryption error.");
        }
    }

    // Prepare response, replacing encrypted fields with decrypted ones
    const responseItem = { ...card };
    delete responseItem.encryptedCardNumber;
    delete responseItem.encryptedCvv;
    if (decryptedCardNumber !== null) {
        responseItem.cardNumber = decryptedCardNumber;
    }
    if (decryptedCvv !== null) {
        responseItem.cvv = decryptedCvv;
    }

    log.info("Wallet card retrieved and decrypted successfully", { cardId, userId });
    return respondWithSuccess(200, responseItem);

  } catch (error) {
    log.error("Error getting wallet card", { error: error.message, stack: error.stack });
    if (error.message.startsWith("Server decryption configuration error") || error.message.startsWith("Failed to decrypt")) {
        return respondWithError(500, error.message);
    }
    return respondWithError(500, "Could not retrieve wallet card. Please try again later.");
  }
};

