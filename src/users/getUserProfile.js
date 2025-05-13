const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const cognito = new AWS.CognitoIdentityServiceProvider();
const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to get user profile", { eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const userPoolId = process.env.COGNITO_USER_POOL_ID;
    const usersTableName = process.env.USERS_TABLE_NAME;

    if (!userPoolId || !usersTableName) {
      log.error("Environment variables COGNITO_USER_POOL_ID or USERS_TABLE_NAME are not set.");
      return respondWithError(500, "Server configuration error.");
    }

    // 1. Fetch Cognito attributes
    let cognitoUser;
    try {
      const cognitoParams = {
        UserPoolId: userPoolId,
        Username: userId, // In Cognito, the username is often the sub (user ID) itself or email
      };
      // Attempt to get user by sub. If this fails, it might be that the primary username is email.
      // For simplicity, assuming userId from token (sub) is the Cognito username.
      // If not, a lookup might be needed or ensure Cognito username is the sub.
      cognitoUser = await cognito.adminGetUser(cognitoParams).promise();
    } catch (cognitoError) {
      log.error("Error fetching user from Cognito", { userId, error: cognitoError.message });
      // If user not found in Cognito (should not happen if token is valid), treat as error
      if (cognitoError.code === "UserNotFoundException") {
        return respondWithError(404, "User profile not found (Cognito lookup failed).");
      }
      return respondWithError(500, "Could not retrieve user data from Cognito.");
    }

    const cognitoAttributes = cognitoUser.UserAttributes.reduce((acc, attr) => {
      acc[attr.Name] = attr.Value;
      return acc;
    }, {});

    // 2. Fetch DynamoDB attributes
    let dynamoUser = {};
    try {
      const dynamoParams = {
        TableName: usersTableName,
        Key: { id: userId }, // 'id' is the primary key in UsersTable, storing Cognito sub
      };
      const dynamoResult = await dynamoDb.get(dynamoParams).promise();
      if (dynamoResult.Item) {
        dynamoUser = dynamoResult.Item;
      }
    } catch (dynamoError) {
      log.error("Error fetching user from DynamoDB", { userId, error: dynamoError.message });
      // Non-fatal, proceed with Cognito data if DynamoDB fetch fails
    }

    // 3. Combine and format profile
    // Prioritize DynamoDB for custom fields, Cognito for auth-related fields
    const userProfile = {
      id: userId,
      userId: userId, // Align with db.json
      email: cognitoAttributes.email,
      name: cognitoAttributes.name || dynamoUser.name, // Cognito 'name' or DynamoDB 'name'
      username: cognitoUser.Username, // Cognito's internal username
      profilePicture: cognitoAttributes.profilePicture || dynamoUser.profilePictureUrl, // Align with db.json
      bio: cognitoAttributes.bio || dynamoUser.bio,
      // Add other fields from db.json or Cognito as needed
      // Example: theme, language from dynamoUser if stored there
      theme: dynamoUser.theme,
      language: dynamoUser.language,
      createdAt: dynamoUser.createdAt || cognitoUser.UserCreateDate, // Prefer DynamoDB if available
      updatedAt: dynamoUser.updatedAt || cognitoUser.UserLastModifiedDate,
      emailVerified: cognitoAttributes.email_verified === "true",
      status: cognitoUser.UserStatus,
    };

    log.info("User profile retrieved successfully", { userId });
    return respondWithSuccess(200, userProfile);

  } catch (error) {
    log.error("Error getting user profile", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not retrieve user profile. Please try again later.");
  }
};

