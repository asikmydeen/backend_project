const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

// KMS is NOT needed for listing as we don't decrypt sensitive data here.

module.exports.handler = async (event) => {
  log.info("Received request to list wallet cards", { queryStringParameters: event.queryStringParameters, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const walletCardsTableName = process.env.WALLET_CARDS_TABLE_NAME;
    // GSI on userId to query all wallet cards for a user
    const walletCardsUserIdGsiName = process.env.WALLET_CARDS_USER_ID_GSI_NAME;

    if (!walletCardsTableName || !walletCardsUserIdGsiName) {
      log.error("Environment variables WALLET_CARDS_TABLE_NAME or WALLET_CARDS_USER_ID_GSI_NAME are not set.");
      return respondWithError(500, "Server configuration error.");
    }

    const { sortBy = 'cardholderName', sortOrder = 'asc' } = event.queryStringParameters || {};

    const dynamoParams = {
      TableName: walletCardsTableName,
      IndexName: walletCardsUserIdGsiName,
      KeyConditionExpression: "userId = :userId",
      ExpressionAttributeValues: { ":userId": userId },
      // IMPORTANT: Project only non-sensitive fields for listing.
      ProjectionExpression: "id, userId, cardholderName, last4Digits, expiryMonth, expiryYear, cardType, bankName, notes, billingAddress, createdAt, updatedAt",
      ScanIndexForward: sortOrder === 'asc', // Depends on GSI sort key
    };

    const result = await dynamoDb.query(dynamoParams).promise();
    log.info("Wallet cards listed successfully", { userId, count: result.Items.length });

    // Items are already projected, so no need to manually delete encrypted fields.
    let itemsToReturn = result.Items;

    // Sorting if GSI doesn't directly support it or for additional fields
    if (sortBy && (sortBy === 'cardholderName' || sortBy === 'bankName' || sortBy === 'cardType' || sortBy === 'updatedAt' || sortBy === 'createdAt')) {
        itemsToReturn.sort((a, b) => {
            const valA = a[sortBy] ? (typeof a[sortBy] === 'string' ? a[sortBy].toLowerCase() : a[sortBy]) : '';
            const valB = b[sortBy] ? (typeof b[sortBy] === 'string' ? b[sortBy].toLowerCase() : b[sortBy]) : '';
            if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
            if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
            return 0;
        });
    }

    return respondWithSuccess(200, itemsToReturn);

  } catch (error) {
    log.error("Error listing wallet cards", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not list wallet cards. Please try again later.");
  }
};

