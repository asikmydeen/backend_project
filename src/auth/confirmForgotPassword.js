const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");

const cognito = new AWS.CognitoIdentityServiceProvider();

module.exports.handler = async (event) => {
  log.info("Received request to confirm forgot password", { body: event.body });

  try {
    const { email, confirmationCode, newPassword } = JSON.parse(event.body);

    if (!email || !confirmationCode || !newPassword) {
      return respondWithError(400, "Email, confirmation code, and new password are required.");
    }

    const clientId = process.env.COGNITO_APP_CLIENT_ID;
    if (!clientId) {
        log.error("Cognito App Client ID is not configured in environment variables.");
        return respondWithError(500, "Server configuration error.");
    }

    const params = {
      ClientId: clientId,
      Username: email,
      ConfirmationCode: confirmationCode,
      Password: newPassword,
    };

    await cognito.confirmForgotPassword(params).promise();
    log.info("Password reset confirmed successfully", { email });

    return respondWithSuccess(200, { message: "Password has been reset successfully. You can now log in with your new password." });

  } catch (error) {
    log.error("Error confirming forgot password", { error: error.message, stack: error.stack });
    if (error.code === "CodeMismatchException") {
      return respondWithError(400, "Invalid confirmation code.");
    }
    if (error.code === "ExpiredCodeException") {
      return respondWithError(400, "Confirmation code has expired. Please request a new one.");
    }
    if (error.code === "UserNotFoundException") {
      return respondWithError(404, "User not found.");
    }
    if (error.code === "InvalidPasswordException") {
      return respondWithError(400, `New password does not meet requirements: ${error.message}`);
    }
    if (error.code === "LimitExceededException") {
        return respondWithError(429, "Attempt limit exceeded, please try after some time.");
    }
    return respondWithError(500, "Could not confirm password reset. Please try again later.");
  }
};

