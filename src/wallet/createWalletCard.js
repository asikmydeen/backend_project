const AWS = require("aws-sdk");
const { v4: uuidv4 } = require("uuid");
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
    Plaintext: Buffer.from(String(data)), // Ensure data is string for encryption
  };
  const { CiphertextBlob } = await kms.encrypt(params).promise();
  return CiphertextBlob.toString("base64");
}

module.exports.handler = async (event) => {
  log.info("Received request to create wallet card", { body: event.body, eventContext: event.requestContext });

  if (!KMS_KEY_ID_WALLET) {
    log.error("KMS_KEY_ID_WALLET is not configured. Cannot proceed with wallet card creation.");
    return respondWithError(500, "Server encryption configuration error. Cannot create wallet card.");
  }

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const requestBody = JSON.parse(event.body);
    const { cardholderName, cardNumber, expiryMonth, expiryYear, cvv, cardType, bankName, notes, billingAddress } = requestBody;

    if (!cardholderName || !cardNumber || !expiryMonth || !expiryYear || !cvv || !cardType) {
      return respondWithError(400, "Cardholder name, card number, expiry month, expiry year, CVV, and card type are required.");
    }

    // Validate expiry month and year (basic validation)
    const currentYear = new Date().getFullYear() % 100; // Last two digits
    const currentMonth = new Date().getMonth() + 1; // 1-12
    const expYearNum = parseInt(expiryYear, 10);
    const expMonthNum = parseInt(expiryMonth, 10);

    if (isNaN(expYearNum) || isNaN(expMonthNum) || expMonthNum < 1 || expMonthNum > 12 || expYearNum < currentYear || (expYearNum === currentYear && expMonthNum < currentMonth)) {
        return respondWithError(400, "Invalid card expiry date.");
    }

    const walletCardsTableName = process.env.WALLET_CARDS_TABLE_NAME;
    if (!walletCardsTableName) {
      log.error("Environment variable WALLET_CARDS_TABLE_NAME is not set.");
      return respondWithError(500, "Server configuration error.");
    }

    const encryptedCardNumber = await encryptData(cardNumber);
    const encryptedCvv = await encryptData(cvv);

    const timestamp = new Date().toISOString();
    const cardId = uuidv4();

    const walletCardItem = {
      id: cardId,
      userId: userId,
      cardholderName: cardholderName,
      encryptedCardNumber: encryptedCardNumber,
      // Store last 4 digits for display purposes, not encrypted
      last4Digits: String(cardNumber).slice(-4),
      expiryMonth: String(expiryMonth).padStart(2, '0'), // Ensure two digits
      expiryYear: String(expiryYear), // Assuming 2 or 4 digit year as input, store as is
      encryptedCvv: encryptedCvv,
      cardType: cardType, // e.g., "Visa", "Mastercard"
      bankName: bankName || "",
      notes: notes || "",
      billingAddress: billingAddress || {}, // Expecting an object { street, city, state, zipCode, country }
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const dynamoParams = {
      TableName: walletCardsTableName,
      Item: walletCardItem,
    };

    await dynamoDb.put(dynamoParams).promise();
    log.info("Wallet card created successfully", { cardId, userId });

    // TODO: Record activity

    // Omit encrypted fields from the response for security
    const responseItem = { ...walletCardItem };
    delete responseItem.encryptedCardNumber;
    delete responseItem.encryptedCvv;

    return respondWithSuccess(201, responseItem);

  } catch (error) {
    log.error("Error creating wallet card", { error: error.message, stack: error.stack });
    if (error instanceof SyntaxError) {
        return respondWithError(400, "Invalid JSON payload.");
    }
    if (error.message === "Server encryption configuration error.") {
        return respondWithError(500, error.message);
    }
    return respondWithError(500, "Could not create wallet card. Please try again later.");
  }
};

