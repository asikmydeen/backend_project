const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const cognito = new AWS.CognitoIdentityServiceProvider();
const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to update user profile", { body: event.body, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const requestBody = JSON.parse(event.body);
    const { name, profilePicture, bio } = requestBody;

    const userPoolId = process.env.COGNITO_USER_POOL_ID;
    const usersTableName = process.env.USERS_TABLE_NAME;

    if (!userPoolId || !usersTableName) {
      log.error("Environment variables COGNITO_USER_POOL_ID or USERS_TABLE_NAME are not set.");
      return respondWithError(500, "Server configuration error.");
    }

    const timestamp = new Date().toISOString();
    let cognitoUpdateNeeded = false;
    const cognitoUserAttributes = [];

    // Prepare Cognito attributes for update
    if (name !== undefined) {
      cognitoUserAttributes.push({ Name: "name", Value: name });
      cognitoUpdateNeeded = true;
    }
    if (profilePicture !== undefined) { // Assuming 'profilePicture' is a custom Cognito attribute
      cognitoUserAttributes.push({ Name: "profilePicture", Value: profilePicture });
      cognitoUpdateNeeded = true;
    }
    if (bio !== undefined) { // Assuming 'bio' is a custom Cognito attribute
      cognitoUserAttributes.push({ Name: "bio", Value: bio });
      cognitoUpdateNeeded = true;
    }

    // 1. Update Cognito attributes if necessary
    if (cognitoUpdateNeeded) {
      try {
        const cognitoParams = {
          UserPoolId: userPoolId,
          Username: userId, // Assuming sub is username
          UserAttributes: cognitoUserAttributes,
        };
        await cognito.adminUpdateUserAttributes(cognitoParams).promise();
        log.info("User attributes updated in Cognito successfully", { userId });
      } catch (cognitoError) {
        log.error("Error updating user attributes in Cognito", { userId, error: cognitoError.message });
        return respondWithError(500, "Could not update user profile in Cognito.");
      }
    }

    // 2. Update DynamoDB attributes
    // Only update fields that are typically stored in DynamoDB or not standard in Cognito
    // For this example, we'll update name, profilePicture, bio in DynamoDB as well for consistency or if they are primary there.
    // In a real app, decide where each piece of profile info is mastered.

    const updateExpressionParts = [];
    const expressionAttributeValues = {};
    const expressionAttributeNames = {};

    if (name !== undefined) {
      updateExpressionParts.push("#n = :n");
      expressionAttributeValues[":n"] = name;
      expressionAttributeNames["#n"] = "name";
    }
    if (profilePicture !== undefined) {
      updateExpressionParts.push("#pp = :pp");
      expressionAttributeValues[":pp"] = profilePicture;
      expressionAttributeNames["#pp"] = "profilePictureUrl"; // Align with db.json
    }
    if (bio !== undefined) {
      updateExpressionParts.push("#b = :b");
      expressionAttributeValues[":b"] = bio;
      expressionAttributeNames["#b"] = "bio";
    }

    if (updateExpressionParts.length > 0) {
        updateExpressionParts.push("#ua = :ua");
        expressionAttributeValues[":ua"] = timestamp;
        expressionAttributeNames["#ua"] = "updatedAt";

        const dynamoParams = {
            TableName: usersTableName,
            Key: { id: userId },
            UpdateExpression: `SET ${updateExpressionParts.join(", ")}`,
            ExpressionAttributeValues: expressionAttributeValues,
            ExpressionAttributeNames: expressionAttributeNames,
            ReturnValues: "UPDATED_NEW",
        };

        try {
            const updatedDynamoUser = await dynamoDb.update(dynamoParams).promise();
            log.info("User profile updated in DynamoDB successfully", { userId, updatedAttributes: updatedDynamoUser.Attributes });
        } catch (dynamoError) {
            log.error("Error updating user profile in DynamoDB", { userId, error: dynamoError.message });
            // If Cognito update succeeded but DynamoDB failed, consider rollback or error state.
            // For now, just log and return error.
            return respondWithError(500, "Could not update user profile in database.");
        }
    } else if (!cognitoUpdateNeeded) {
        return respondWithSuccess(200, { message: "No changes provided to update." });
    }

    // Fetch the combined profile to return the updated state
    // Re-using parts of getUserProfile logic for simplicity, or construct from updates
    // For now, just return success message, client can re-fetch if needed.
    return respondWithSuccess(200, { message: "User profile updated successfully." });

  } catch (error) {
    log.error("Error updating user profile", { error: error.message, stack: error.stack });
    if (error instanceof SyntaxError) { // JSON.parse error
        return respondWithError(400, "Invalid JSON payload.");
    }
    return respondWithError(500, "Could not update user profile. Please try again later.");
  }
};

