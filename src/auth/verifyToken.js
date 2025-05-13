const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromToken, getUserAttributesFromToken } = require("../utils/authUtils");

// Cognito SDK is not directly used here as API Gateway authorizer handles verification.
// This Lambda is more about returning user info if the token is valid (already checked by authorizer).

module.exports.handler = async (event) => {
  log.info("Received request to verify token and get user info", { headers: event.headers });

  try {
    // The Cognito Authorizer in API Gateway should have already validated the token.
    // The event.requestContext.authorizer object will contain claims if the token is valid.
    const claims = event.requestContext?.authorizer?.claims;

    if (!claims) {
      log.warn("No claims found in requestContext.authorizer. Token might be invalid or authorizer not configured correctly.");
      // This should ideally be caught by the API Gateway Authorizer itself.
      return respondWithError(401, "Unauthorized. Invalid or missing token claims.");
    }

    const userId = claims.sub; // 'sub' is the standard claim for user ID (Cognito User Sub)
    const email = claims.email;
    const name = claims.name; // Assuming 'name' is a standard attribute in your Cognito User Pool
    // Add any other attributes you want to return from the token claims

    log.info("Token verified successfully by API Gateway Authorizer. Returning user info.", { userId, email });

    return respondWithSuccess(200, {
      message: "Token is valid.",
      user: {
        id: userId,
        userId: userId, // Aligning with db.json 'userId' field
        email: email,
        name: name,
        // Add other relevant user attributes from claims here
      },
    });

  } catch (error) {
    log.error("Error in verifyToken Lambda (should be minimal if authorizer works)", { error: error.message, stack: error.stack });
    // This error block is more of a fallback.
    // If the authorizer fails, it should return 401/403 before reaching the Lambda.
    return respondWithError(500, "Could not verify token due to an internal error.");
  }
};

