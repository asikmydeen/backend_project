const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromToken } = require("../utils/authUtils"); // To get user details from token

const cognito = new AWS.CognitoIdentityServiceProvider();

module.exports.handler = async (event) => {
  log.info("Received request to sign out user", { headers: event.headers });

  try {
    // Sign out is typically done by invalidating the token on the client-side.
    // For a more robust server-side sign-out (e.g., global sign-out), Cognito's GlobalSignOut or AdminUserGlobalSignOut can be used.
    // Here, we'll implement GlobalSignOut which signs the user out from all devices.

    const accessToken = event.headers?.Authorization?.split(" ")[1] || event.headers?.authorization?.split(" ")[1];

    if (!accessToken) {
      return respondWithError(401, "Access token is required.");
    }

    // No need to call getUserIdFromToken here as GlobalSignOut uses the AccessToken directly.

    const params = {
      AccessToken: accessToken,
    };

    await cognito.globalSignOut(params).promise();
    log.info("User signed out globally successfully");

    return respondWithSuccess(200, { message: "Signed out successfully from all devices." });

  } catch (error) {
    log.error("Error signing out user", { error: error.message, stack: error.stack });
    if (error.code === "NotAuthorizedException") {
        // This can happen if the token is already invalid or expired
        return respondWithError(401, "Invalid or expired token. Already signed out or session expired.");
    }
    if (error.code === "TooManyRequestsException") {
        return respondWithError(429, "Too many requests. Please try again later.");
    }
    // For other errors, a generic message is safer.
    return respondWithError(500, "Could not sign out user. Please try again later.");
  }
};

