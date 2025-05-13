const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

// KMS is not needed for delete operation.

module.exports.handler = async (event) => {
  log.info("Received request to delete wallet card", { pathParameters: event.pathParameters, eventContext: event.requestContext });

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

    // First, get the card to ensure it exists and belongs to the user before deleting
    const getParams = {
      TableName: walletCardsTableName,
      Key: {
        id: cardId,
      },
      ProjectionExpression: "id, userId", // Only need these for verification
    };

    const getResult = await dynamoDb.get(getParams).promise();

    if (!getResult.Item) {
      log.warn("Wallet card not found for deletion", { cardId, userId });
      return respondWithError(404, "Wallet card not found.");
    }

    if (getResult.Item.userId !== userId) {
      log.warn("User attempted to delete a wallet card they do not own", { cardId, requestingUserId: userId, ownerUserId: getResult.Item.userId });
      return respondWithError(403, "Forbidden: You do not have permission to delete this wallet card.");
    }

    // Delete the card
    const deleteParams = {
      TableName: walletCardsTableName,
      Key: {
        id: cardId,
      },
    };

    await dynamoDb.delete(deleteParams).promise();
    log.info("Wallet card deleted successfully", { cardId, userId });

    // TODO: Record activity (e.g., wallet card deleted)
    // await recordActivity(userId, "DELETE_WALLET_CARD", { cardId });

    return respondWithSuccess(204, { message: "Wallet card deleted successfully." }); // 204 No Content for successful deletion

  } catch (error) {
    log.error("Error deleting wallet card", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not delete wallet card. Please try again later.");
  }
};

