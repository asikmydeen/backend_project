const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");

const cognito = new AWS.CognitoIdentityServiceProvider();

module.exports.handler = async (event) => {
  log.info("Received request for forgot password", { body: event.body });

  try {
    const { email } = JSON.parse(event.body);

    if (!email) {
      return respondWithError(400, "Email is required.");
    }

    const clientId = process.env.COGNITO_APP_CLIENT_ID;
    if (!clientId) {
        log.error("Cognito App Client ID is not configured in environment variables.");
        return respondWithError(500, "Server configuration error.");
    }

    const params = {
      ClientId: clientId,
      Username: email,
    };

    await cognito.forgotPassword(params).promise();
    log.info("Forgot password process initiated successfully", { email });

    return respondWithSuccess(200, { message: "Password reset code sent successfully. Please check your email." });

  } catch (error) {
    log.error("Error initiating forgot password", { error: error.message, stack: error.stack });
    if (error.code === "UserNotFoundException") {
      // To prevent user enumeration, it's often better to return a generic success message.
      // However, for this implementation, we'll return a 404 for clarity during development.
      // In a production system, consider returning a 200 OK to avoid revealing if an email is registered.
      return respondWithError(404, "User with this email not found.");
    }
    if (error.code === "InvalidParameterException" && error.message.includes("User is not confirmed")){
        return respondWithError(403, "User account is not confirmed. Please confirm your account first.");
    }
    if (error.code === "LimitExceededException") {
        return respondWithError(429, "Attempt limit exceeded, please try after some time.");
    }
    return respondWithError(500, "Could not initiate password reset. Please try again later.");
  }
};

