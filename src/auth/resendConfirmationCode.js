const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");

const cognito = new AWS.CognitoIdentityServiceProvider();

module.exports.handler = async (event) => {
  log.info("Received request to resend confirmation code", { body: event.body });

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

    await cognito.resendConfirmationCode(params).promise();
    log.info("Confirmation code resent successfully", { email });

    return respondWithSuccess(200, { message: "Confirmation code resent successfully. Please check your email." });

  } catch (error) {
    log.error("Error resending confirmation code", { error: error.message, stack: error.stack });
    if (error.code === "UserNotFoundException") {
      return respondWithError(404, "User not found. Please register first.");
    }
    if (error.code === "InvalidParameterException" && error.message.includes("User is already confirmed")) {
        // Cognito might return InvalidParameterException or NotAuthorizedException for already confirmed user depending on flow
        // Checking message for more specific feedback
        return respondWithError(409, "User is already confirmed.");
    }
     if (error.code === "LimitExceededException") {
        return respondWithError(429, "Attempt limit exceeded, please try after some time.");
    }
    return respondWithError(500, "Could not resend confirmation code. Please try again later.");
  }
};

