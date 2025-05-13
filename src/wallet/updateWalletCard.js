const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();
const kms = new AWS.KMS();

// Environment variable for the KMS Key ID for Wallet data
const KMS_KEY_ID_WALLET = process.env.KMS_KEY_ID_WALLET;

async function encryptData(data) {
  if (!KMS_KEY_ID_WALLET) {
    log.error("KMS_KEY_ID_WALLET environment variable is not set.");
    throw new Error("Server encryption configuration error.");
  }
  const params = {
    KeyId: KMS_KEY_ID_WALLET,
    Plaintext: Buffer.from(String(data)),
  };
  const { CiphertextBlob } = await kms.encrypt(params).promise();
  return CiphertextBlob.toString("base64");
}

module.exports.handler = async (event) => {
  log.info("Received request to update wallet card", { pathParameters: event.pathParameters, body: event.body, eventContext: event.requestContext });

  if (!KMS_KEY_ID_WALLET) {
    log.error("KMS_KEY_ID_WALLET is not configured. Cannot proceed with wallet card update.");
    return respondWithError(500, "Server encryption configuration error. Cannot update wallet card.");
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

    const requestBody = JSON.parse(event.body);
    const { cardholderName, cardNumber, expiryMonth, expiryYear, cvv, cardType, bankName, notes, billingAddress } = requestBody;

    const walletCardsTableName = process.env.WALLET_CARDS_TABLE_NAME;
    if (!walletCardsTableName) {
      log.error("Environment variable WALLET_CARDS_TABLE_NAME is not set.");
      return respondWithError(500, "Server configuration error.");
    }

    // First, get the card to ensure it exists and belongs to the user
    const getParams = {
      TableName: walletCardsTableName,
      Key: { id: cardId },
    };
    const getResult = await dynamoDb.get(getParams).promise();

    if (!getResult.Item) {
      log.warn("Wallet card not found for update", { cardId, userId });
      return respondWithError(404, "Wallet card not found.");
    }

    if (getResult.Item.userId !== userId) {
      log.warn("User attempted to update a wallet card they do not own", { cardId, requestingUserId: userId, ownerUserId: getResult.Item.userId });
      return respondWithError(403, "Forbidden: You do not have permission to update this wallet card.");
    }

    // Prepare update expression
    const timestamp = new Date().toISOString();
    let updateExpression = "SET updatedAt = :updatedAt";
    const expressionAttributeValues = { ":updatedAt": timestamp };
    const expressionAttributeNames = {}; // For reserved keywords

    if (cardholderName !== undefined) {
      updateExpression += ", cardholderName = :cardholderName";
      expressionAttributeValues[":cardholderName"] = cardholderName;
    }
    if (cardNumber !== undefined) {
      const encryptedCardNumber = await encryptData(cardNumber);
      updateExpression += ", encryptedCardNumber = :encryptedCardNumber, last4Digits = :last4Digits";
      expressionAttributeValues[":encryptedCardNumber"] = encryptedCardNumber;
      expressionAttributeValues[":last4Digits"] = String(cardNumber).slice(-4);
    }
    if (expiryMonth !== undefined) {
      updateExpression += ", expiryMonth = :expiryMonth";
      expressionAttributeValues[":expiryMonth"] = String(expiryMonth).padStart(2, '0');
    }
    if (expiryYear !== undefined) {
      updateExpression += ", expiryYear = :expiryYear";
      expressionAttributeValues[":expiryYear"] = String(expiryYear);
    }
    if (cvv !== undefined) {
      const encryptedCvv = await encryptData(cvv);
      updateExpression += ", encryptedCvv = :encryptedCvv";
      expressionAttributeValues[":encryptedCvv"] = encryptedCvv;
    }
    if (cardType !== undefined) {
      updateExpression += ", cardType = :cardType";
      expressionAttributeValues[":cardType"] = cardType;
    }
    if (bankName !== undefined) {
      updateExpression += ", bankName = :bankName";
      expressionAttributeValues[":bankName"] = bankName;
    }
    if (notes !== undefined) {
      updateExpression += ", notes = :notes";
      expressionAttributeValues[":notes"] = notes;
    }
    if (billingAddress !== undefined) {
      updateExpression += ", billingAddress = :billingAddress";
      expressionAttributeValues[":billingAddress"] = billingAddress; // billingAddress is an object
    }
    
    // Validate expiry date if provided
    if (expiryMonth !== undefined || expiryYear !== undefined) {
        const currentCard = getResult.Item;
        const newExpiryMonth = expiryMonth !== undefined ? parseInt(String(expiryMonth), 10) : parseInt(currentCard.expiryMonth, 10);
        const newExpiryYear = expiryYear !== undefined ? parseInt(String(expiryYear), 10) : parseInt(currentCard.expiryYear, 10); // Assuming year is stored as YY or YYYY
        
        const currentSysYear = new Date().getFullYear();
        const currentSysMonth = new Date().getMonth() + 1; 
        let expYearFull = newExpiryYear;
        // If expiryYear is 2 digits, convert to 4 digits (e.g. 25 -> 2025)
        if (String(newExpiryYear).length === 2) {
            expYearFull = 2000 + newExpiryYear;
        }

        if (isNaN(expYearFull) || isNaN(newExpiryMonth) || newExpiryMonth < 1 || newExpiryMonth > 12 || expYearFull < currentSysYear || (expYearFull === currentSysYear && newExpiryMonth < currentSysMonth)) {
            return respondWithError(400, "Invalid card expiry date.");
        }
        // If validation passes, ensure they are stored in the correct format if changed by the update
        if (expiryMonth !== undefined) expressionAttributeValues[":expiryMonth"] = String(newExpiryMonth).padStart(2, '0');
        if (expiryYear !== undefined) expressionAttributeValues[":expiryYear"] = String(newExpiryYear); // Store as provided (2 or 4 digit)
    }

    if (Object.keys(requestBody).length === 0) {
        const currentItem = { ...getResult.Item };
        delete currentItem.encryptedCardNumber;
        delete currentItem.encryptedCvv;
        return respondWithSuccess(200, { message: "No fields provided for update.", card: currentItem });
    }

    const updateParams = {
      TableName: walletCardsTableName,
      Key: { id: cardId },
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: "ALL_NEW",
    };

    if (Object.keys(expressionAttributeNames).length > 0) {
        updateParams.ExpressionAttributeNames = expressionAttributeNames;
    }

    const updatedResult = await dynamoDb.update(updateParams).promise();
    log.info("Wallet card updated successfully", { cardId, userId });

    const responseItem = { ...updatedResult.Attributes };
    delete responseItem.encryptedCardNumber;
    delete responseItem.encryptedCvv;

    // TODO: Record activity

    return respondWithSuccess(200, responseItem);

  } catch (error) {
    log.error("Error updating wallet card", { error: error.message, stack: error.stack });
    if (error instanceof SyntaxError) {
        return respondWithError(400, "Invalid JSON payload.");
    }
    if (error.message === "Server encryption configuration error.") {
        return respondWithError(500, error.message);
    }
    return respondWithError(500, "Could not update wallet card. Please try again later.");
  }
};

