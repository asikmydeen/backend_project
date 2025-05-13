const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");

const cognito = new AWS.CognitoIdentityServiceProvider();

module.exports.handler = async (event) => {
  log.info("Received request to confirm signup", { body: event.body });

  try {
    const { email, confirmationCode } = JSON.parse(event.body);

    if (!email || !confirmationCode) {
      return respondWithError(400, "Email and confirmation code are required.");
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
    };

    await cognito.confirmSignUp(params).promise();
    log.info("User signup confirmed successfully", { email });

    return respondWithSuccess(200, { message: "Account confirmed successfully. You can now log in." });

  } catch (error) {
    log.error("Error confirming signup", { error: error.message, stack: error.stack });
    if (error.code === "CodeMismatchException") {
      return respondWithError(400, "Invalid confirmation code.");
    }
    if (error.code === "ExpiredCodeException") {
      return respondWithError(400, "Confirmation code has expired. Please request a new one.");
    }
    if (error.code === "UserNotFoundException") {
      return respondWithError(404, "User not found. Please register first.");
    }
    if (error.code === "NotAuthorizedException" && error.message.includes("User is already confirmed")) {
        return respondWithError(409, "User is already confirmed.");
    }
    return respondWithError(500, "Could not confirm signup. Please try again later.");
  }
};

