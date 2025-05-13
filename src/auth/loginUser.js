const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");

const cognito = new AWS.CognitoIdentityServiceProvider();

module.exports.handler = async (event) => {
  log.info("Received request to login user", { body: event.body });

  try {
    const { email, password } = JSON.parse(event.body);

    if (!email || !password) {
      return respondWithError(400, "Email and password are required.");
    }

    const userPoolId = process.env.COGNITO_USER_POOL_ID;
    const clientId = process.env.COGNITO_APP_CLIENT_ID;

    if (!userPoolId || !clientId) {
        log.error("Cognito User Pool ID or Client ID is not configured in environment variables.");
        return respondWithError(500, "Server configuration error.");
    }

    const params = {
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: clientId,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
      },
    };

    const data = await cognito.initiateAuth(params).promise();
    log.info("User logged in successfully", { email });

    if (data.AuthenticationResult) {
      return respondWithSuccess(200, {
        message: "Login successful.",
        token: data.AuthenticationResult.IdToken,
        refreshToken: data.AuthenticationResult.RefreshToken,
        accessToken: data.AuthenticationResult.AccessToken,
      });
    } else {
      // This case should ideally not be reached if initiateAuth is successful without challenge
      log.warn("Login attempt did not return AuthenticationResult directly", { responseData: data });
      return respondWithError(500, "Login failed. Unexpected response from authentication service.");
    }

  } catch (error) {
    log.error("Error logging in user", { error: error.message, stack: error.stack });
    if (error.code === "NotAuthorizedException" || error.code === "UserNotFoundException") {
      return respondWithError(401, "Invalid email or password.");
    }
    if (error.code === "UserNotConfirmedException") {
      return respondWithError(403, "User account is not confirmed. Please check your email.");
    }
    return respondWithError(500, "Could not log in user. Please try again later.");
  }
};

