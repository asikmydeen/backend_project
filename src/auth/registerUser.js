const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");

const cognito = new AWS.CognitoIdentityServiceProvider();

module.exports.handler = async (event) => {
  log.info("Received request to register user", { body: event.body });

  try {
    const { email, password, name } = JSON.parse(event.body);

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
      ClientId: clientId,
      Username: email,
      Password: password,
      UserAttributes: [
        {
          Name: "email",
          Value: email,
        },
        {
          Name: "name",
          Value: name || "", // Optional attribute
        },
      ],
    };

    const data = await cognito.signUp(params).promise();
    log.info("User signed up successfully", { userId: data.UserSub });

    // Optionally, create a corresponding entry in the UsersTable if needed immediately
    // For now, focusing on Cognito registration as per basic auth flow

    return respondWithSuccess(201, {
      message: "User registered successfully. Please check your email to confirm your account.",
      userId: data.UserSub,
    });

  } catch (error) {
    log.error("Error registering user", { error: error.message, stack: error.stack });
    if (error.code === "UsernameExistsException") {
      return respondWithError(409, "An account with this email already exists.");
    }
    if (error.code === "InvalidPasswordException") {
      return respondWithError(400, `Password does not meet requirements: ${error.message}`);
    }
    if (error.code === "InvalidParameterException") {
        return respondWithError(400, `Invalid parameter: ${error.message}`);
    }
    return respondWithError(500, "Could not register user. Please try again later.");
  }
};

