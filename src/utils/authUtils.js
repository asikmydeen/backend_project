const AWS = require("aws-sdk");
const { CognitoIdentityProviderClient, GetUserCommand } = require("@aws-sdk/client-cognito-identity-provider");
const { verify } = require("jsonwebtoken");
const jwksClient = require("jwks-rsa");
const { log } = require("./logger");

const cognitoClient = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });

const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;
const APP_CLIENT_ID = process.env.COGNITO_APP_CLIENT_ID; // For token validation if needed

const client = jwksClient({
  jwksUri: `https://cognito-idp.${process.env.AWS_REGION}.amazonaws.com/${USER_POOL_ID}/.well-known/jwks.json`,
});

function getKey(header, callback) {
  client.getSigningKey(header.kid, function (err, key) {
    if (err) {
      log("Error getting signing key from JWKS", { error: err });
      return callback(err);
    }
    const signingKey = key.getPublicKey(); // For RS256, this is what we need
    callback(null, signingKey);
  });
}

async function verifyToken(token) {
  return new Promise((resolve, reject) => {
    verify(token, getKey, { algorithms: ["RS256"] }, (err, decoded) => {
      if (err) {
        log("JWT verification error", { error: err.message, token });
        if (err.name === "TokenExpiredError") {
          return reject(new Error("Token has expired."));
        }
        if (err.name === "JsonWebTokenError") {
          return reject(new Error("Invalid token."));
        }
        return reject(err);
      }
      // Optional: Check if token `aud` (audience) matches your App Client ID
      // if (decoded.aud !== APP_CLIENT_ID) { // or decoded.client_id for some Cognito setups
      //   log("Token audience/client_id mismatch", { aud: decoded.aud, expected: APP_CLIENT_ID });
      //   return reject(new Error("Token not intended for this application."));
      // }
      log("JWT verified successfully", { decoded });
      resolve(decoded);
    });
  });
}

async function getUserDetails(accessToken) {
  try {
    const command = new GetUserCommand({ AccessToken: accessToken });
    const response = await cognitoClient.send(command);
    log("User details fetched from Cognito", { username: response.Username });
    // Map attributes to a more usable object
    const userAttributes = {};
    response.UserAttributes.forEach(attr => {
      userAttributes[attr.Name] = attr.Value;
    });
    return {
      username: response.Username,
      attributes: userAttributes,
      // sub is typically in userAttributes.sub or directly in decoded token
    };
  } catch (error) {
    log("Error fetching user details from Cognito", { error: error.message });
    throw new Error("Could not fetch user details.");
  }
}

/**
 * Extract user ID from the event object
 * @param {Object} event - API Gateway event object
 * @returns {string|null} - User ID or null if not found
 */
function getUserIdFromEvent(event) {
  try {
    // Check if user ID is in the Cognito authorizer claims
    if (event.requestContext &&
        event.requestContext.authorizer &&
        event.requestContext.authorizer.claims &&
        event.requestContext.authorizer.claims.sub) {
      return event.requestContext.authorizer.claims.sub;
    }
    
    // Fallback: Try to extract from the Authorization header if present
    if (event.headers && event.headers.Authorization) {
      const token = event.headers.Authorization.replace('Bearer ', '');
      // This is a synchronous check - in production you might want to verify the token
      // For testing purposes, we'll just extract the user ID if possible
      try {
        const decoded = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        if (decoded && decoded.sub) {
          return decoded.sub;
        }
      } catch (err) {
        log("Error decoding token", { error: err.message });
      }
    }
    
    return null;
  } catch (error) {
    log("Error extracting user ID from event", { error: error.message });
    return null;
  }
}

module.exports = {
  verifyToken,
  getUserDetails,
  getUserIdFromEvent,
};
