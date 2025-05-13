const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to update user settings", { body: event.body, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const requestBody = JSON.parse(event.body);
    // Assuming settings like theme, language, notifications preferences are stored in DynamoDB
    const { theme, language, notifications } = requestBody;

    const usersTableName = process.env.USERS_TABLE_NAME;
    if (!usersTableName) {
      log.error("Environment variable USERS_TABLE_NAME is not set.");
      return respondWithError(500, "Server configuration error.");
    }

    const timestamp = new Date().toISOString();
    const updateExpressionParts = [];
    const expressionAttributeValues = {};
    const expressionAttributeNames = {};

    if (theme !== undefined) {
      updateExpressionParts.push("#t = :t");
      expressionAttributeValues[":t"] = theme;
      expressionAttributeNames["#t"] = "theme";
    }
    if (language !== undefined) {
      updateExpressionParts.push("#l = :l");
      expressionAttributeValues[":l"] = language;
      expressionAttributeNames["#l"] = "language";
    }
    if (notifications !== undefined) { // Assuming notifications is an object e.g., { email: true, push: false }
      updateExpressionParts.push("#n = :n");
      expressionAttributeValues[":n"] = notifications;
      expressionAttributeNames["#n"] = "notificationSettings"; // Align with potential db.json structure
    }

    if (updateExpressionParts.length === 0) {
      return respondWithSuccess(200, { message: "No settings provided to update." });
    }

    updateExpressionParts.push("#ua = :ua");
    expressionAttributeValues[":ua"] = timestamp;
    expressionAttributeNames["#ua"] = "updatedAt";
    
    // Ensure createdAt is set if it doesn't exist, though typically set on user creation
    updateExpressionParts.push("#ca = if_not_exists(#ca, :ca_val)");
    expressionAttributeValues[":ca_val"] = timestamp; // Or a more accurate creation time if available
    expressionAttributeNames["#ca"] = "createdAt";


    const dynamoParams = {
      TableName: usersTableName,
      Key: { id: userId },
      UpdateExpression: `SET ${updateExpressionParts.join(", ")}`,
      ExpressionAttributeValues: expressionAttributeValues,
      ExpressionAttributeNames: expressionAttributeNames,
      ReturnValues: "UPDATED_NEW",
    };

    try {
      const updatedSettings = await dynamoDb.update(dynamoParams).promise();
      log.info("User settings updated in DynamoDB successfully", { userId, updatedAttributes: updatedSettings.Attributes });
      return respondWithSuccess(200, { message: "User settings updated successfully.", settings: updatedSettings.Attributes });
    } catch (dynamoError) {
      log.error("Error updating user settings in DynamoDB", { userId, error: dynamoError.message });
      return respondWithError(500, "Could not update user settings.");
    }

  } catch (error) {
    log.error("Error updating user settings", { error: error.message, stack: error.stack });
    if (error instanceof SyntaxError) { // JSON.parse error
        return respondWithError(400, "Invalid JSON payload.");
    }
    return respondWithError(500, "Could not update user settings. Please try again later.");
  }
};

