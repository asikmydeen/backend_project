const AWS = require("aws-sdk");
const { v4: uuidv4 } = require("uuid");
const log = require("../utils/logger");
// This function is intended to be called internally by other Lambdas, not directly via API Gateway.
// Therefore, it doesn't use respondWithSuccess/respondWithError or getUserIdFromEvent directly.

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.recordActivity = async (userId, activityType, details = {}, actorIpAddress = null) => {
  const activitiesTableName = process.env.ACTIVITIES_TABLE_NAME;
  if (!activitiesTableName) {
    log.error("Environment variable ACTIVITIES_TABLE_NAME is not set. Cannot record activity.");
    // Depending on the calling context, you might throw an error or log and continue.
    // For critical activities, throwing an error might be appropriate.
    throw new Error("Activity table not configured. Cannot record activity.");
  }

  if (!userId || !activityType) {
    log.error("User ID and activity type are required to record activity.", { userId, activityType });
    throw new Error("User ID and activity type are required.");
  }

  const timestamp = new Date().toISOString();
  const activityId = uuidv4();

  const activityItem = {
    id: activityId,
    userId: userId, // The user who performed the activity
    activityType: activityType, // e.g., 'CREATE_NOTE', 'LOGIN_SUCCESS', 'UPDATE_PROFILE_PICTURE'
    timestamp: timestamp, // For GSI sorting, also store as createdAt for consistency if needed elsewhere
    createdAt: timestamp, // Redundant with timestamp but good for consistency with other tables
    details: details, // Object containing context-specific information (e.g., { noteId: '...', title: '...' })
    actorIpAddress: actorIpAddress, // Optional: IP address of the user performing the action
    // You could add other fields like userAgent, affectedResourceId, affectedResourceType, etc.
  };

  const params = {
    TableName: activitiesTableName,
    Item: activityItem,
  };

  try {
    await dynamoDb.put(params).promise();
    log.info("Activity recorded successfully", { activityId, userId, activityType });
    return activityItem;
  } catch (error) {
    log.error("Error recording activity", { error: error.message, stack: error.stack, userId, activityType, details });
    // Depending on requirements, you might re-throw or handle differently
    throw new Error("Could not record activity.");
  }
};

