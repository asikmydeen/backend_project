const AWS = require("aws-sdk");
const { v4: uuidv4 } = require("uuid");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");
const { getUserIdFromEvent } = require("../utils/authUtils");

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.handler = async (event) => {
  log.info("Received request to invite collaborator", { body: event.body, eventContext: event.requestContext });

  try {
    const userId = getUserIdFromEvent(event);
    if (!userId) {
      return respondWithError(401, "Unauthorized: User ID not found in token claims.");
    }

    const requestBody = JSON.parse(event.body);
    const { resourceType, resourceId, email, permissions, message } = requestBody;

    if (!resourceType || !resourceId || !email) {
      return respondWithError(400, "Resource type, resource ID, and email are required.");
    }

    // Validate resource type
    const validResourceTypes = ["file", "folder", "album"];
    if (!validResourceTypes.includes(resourceType)) {
      return respondWithError(400, `Invalid resource type. Must be one of: ${validResourceTypes.join(", ")}`);
    }

    // Validate permissions
    const validPermissions = ["view", "edit", "admin"];
    if (permissions && !validPermissions.includes(permissions)) {
      return respondWithError(400, `Invalid permissions. Must be one of: ${validPermissions.join(", ")}`);
    }

    // Verify the resource exists and belongs to the user
    const resourceTableMap = {
      file: process.env.FILES_TABLE_NAME,
      folder: process.env.FOLDERS_TABLE_NAME,
      album: process.env.ALBUMS_TABLE_NAME,
    };

    const resourceTableName = resourceTableMap[resourceType];
    if (!resourceTableName) {
      log.error(`Environment variable for ${resourceType} table is not set.`);
      return respondWithError(500, "Server configuration error.");
    }

    const resourceParams = {
      TableName: resourceTableName,
      Key: { id: resourceId },
    };

    const resourceResult = await dynamoDb.get(resourceParams).promise();
    if (!resourceResult.Item) {
      return respondWithError(404, `${resourceType.charAt(0).toUpperCase() + resourceType.slice(1)} not found.`);
    }

    const resource = resourceResult.Item;
    
    if (resource.userId !== userId) {
      return respondWithError(403, `You do not have permission to share this ${resourceType}.`);
    }

    // Check if the user exists
    const usersTableName = process.env.USERS_TABLE_NAME;
    if (!usersTableName) {
      log.error("Environment variable USERS_TABLE_NAME is not set.");
      return respondWithError(500, "Server configuration error.");
    }

    // Find the user by email
    const userParams = {
      TableName: usersTableName,
      IndexName: "EmailIndex", // Assuming a GSI on email
      KeyConditionExpression: "email = :email",
      ExpressionAttributeValues: {
        ":email": email,
      },
    };

    const userResult = await dynamoDb.query(userParams).promise();
    let collaboratorId = null;
    
    if (userResult.Items.length > 0) {
      collaboratorId = userResult.Items[0].id;
    }

    const collaborationsTableName = process.env.COLLABORATIONS_TABLE_NAME;
    if (!collaborationsTableName) {
      log.error("Environment variable COLLABORATIONS_TABLE_NAME is not set.");
      return respondWithError(500, "Server configuration error.");
    }

    // Check if a collaboration already exists
    if (collaboratorId) {
      const existingCollabParams = {
        TableName: collaborationsTableName,
        FilterExpression: "resourceType = :resourceType AND resourceId = :resourceId AND collaboratorId = :collaboratorId",
        ExpressionAttributeValues: {
          ":resourceType": resourceType,
          ":resourceId": resourceId,
          ":collaboratorId": collaboratorId,
        },
      };

      const existingCollabResult = await dynamoDb.scan(existingCollabParams).promise();
      if (existingCollabResult.Count > 0) {
        return respondWithError(409, "A collaboration already exists with this user for this resource.");
      }
    }

    const timestamp = new Date().toISOString();
    const collaborationId = uuidv4();
    const inviteCode = generateInviteCode();

    const collaborationItem = {
      id: collaborationId,
      ownerId: userId,
      collaboratorId: collaboratorId,
      collaboratorEmail: email,
      resourceType: resourceType,
      resourceId: resourceId,
      permissions: permissions || "view",
      status: collaboratorId ? "pending" : "invited",
      inviteCode: inviteCode,
      message: message || "",
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const dynamoParams = {
      TableName: collaborationsTableName,
      Item: collaborationItem,
    };

    await dynamoDb.put(dynamoParams).promise();
    log.info("Collaboration invitation created successfully", { collaborationId, userId, email, resourceType, resourceId });

    // TODO: Send email notification to the collaborator

    // Generate the invitation URL
    const apiGatewayUrl = process.env.API_GATEWAY_URL || "https://api.example.com";
    const inviteUrl = `${apiGatewayUrl}/collaborations/accept/${inviteCode}`;

    return respondWithSuccess(201, {
      ...collaborationItem,
      inviteUrl: inviteUrl,
    });

  } catch (error) {
    log.error("Error inviting collaborator", { error: error.message, stack: error.stack });
    if (error instanceof SyntaxError) {
      return respondWithError(400, "Invalid JSON payload.");
    }
    return respondWithError(500, "Could not invite collaborator. Please try again later.");
  }
};

// Helper function to generate a random invite code
function generateInviteCode(length = 10) {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}
