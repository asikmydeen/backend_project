const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to accept collaboration invite", { pathParameters: event.pathParameters, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const { inviteCode } = event.pathParameters;
    if (!inviteCode) {
      return respondWithError(400, "Invite code is required.");
    }

    const collaborationsTableName = process.env.COLLABORATIONS_TABLE_NAME;
    if (!collaborationsTableName) {
      log.error("Environment variable COLLABORATIONS_TABLE_NAME is not set.");
      return respondWithError(500, "Server configuration error.");
    }

    // Find the collaboration by invite code
    const queryParams = {
      TableName: collaborationsTableName,
      IndexName: "InviteCodeIndex", // Assuming a GSI on inviteCode
      KeyConditionExpression: "inviteCode = :inviteCode",
      ExpressionAttributeValues: {
        ":inviteCode": inviteCode,
      },
    };

    const queryResult = await dynamoDb.query(queryParams).promise();
    if (queryResult.Items.length === 0) {
      return respondWithError(404, "Collaboration invitation not found.");
    }

    const collaboration = queryResult.Items[0];
    
    // Get the user's email
    const usersTableName = process.env.USERS_TABLE_NAME;
    if (!usersTableName) {
      log.error("Environment variable USERS_TABLE_NAME is not set.");
      return respondWithError(500, "Server configuration error.");
    }

    const userParams = {
      TableName: usersTableName,
      Key: { id: userId },
    };

    const userResult = await dynamoDb.get(userParams).promise();
    if (!userResult.Item) {
      return respondWithError(404, "User not found.");
    }

    const user = userResult.Item;
    
    // Verify the invitation is for this user
    if (collaboration.collaboratorId && collaboration.collaboratorId !== userId) {
      return respondWithError(403, "This invitation is not for you.");
    }

    if (!collaboration.collaboratorId && collaboration.collaboratorEmail !== user.email) {
      return respondWithError(403, "This invitation is not for your email address.");
    }

    // Update the collaboration
    const updateParams = {
      TableName: collaborationsTableName,
      Key: { id: collaboration.id },
      UpdateExpression: "set collaboratorId = :collaboratorId, #status = :status, updatedAt = :updatedAt",
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":collaboratorId": userId,
        ":status": "accepted",
        ":updatedAt": new Date().toISOString(),
      },
      ReturnValues: "ALL_NEW",
    };

    const updateResult = await dynamoDb.update(updateParams).promise();
    log.info("Collaboration invitation accepted successfully", { collaborationId: collaboration.id, userId });

    // TODO: Send notification to the resource owner

    return respondWithSuccess(200, updateResult.Attributes);

  } catch (error) {
    log.error("Error accepting collaboration invite", { error: error.message, stack: error.stack });
    return respondWithError(500, "Could not accept collaboration invite. Please try again later.");
  }
};
