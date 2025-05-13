const AWS = require("aws-sdk");
const { respondWithSuccess, respondWithError } = require("../utils/apiResponses");
const log = require("../utils/logger");

const dynamoDb = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3();

module.exports.handler = async (event) => {
  log.info("Received request to access shared item", { pathParameters: event.pathParameters, body: event.body, eventContext: event.requestContext });

  try {
    const { shareCode } = event.pathParameters;
    if (!shareCode) {
      return respondWithError(400, "Share code is required.");
    }

    // If there's a body, it might contain a password
    let password = null;
    if (event.body) {
      const requestBody = JSON.parse(event.body);
      password = requestBody.password;
    }

    const shareLinksTableName = process.env.SHARE_LINKS_TABLE_NAME;
    if (!shareLinksTableName) {
      log.error("Environment variable SHARE_LINKS_TABLE_NAME is not set.");
      return respondWithError(500, "Server configuration error.");
    }

    // Find the share link by share code
    const queryParams = {
      TableName: shareLinksTableName,
      IndexName: "ShareCodeIndex", // Assuming a GSI on shareCode
      KeyConditionExpression: "shareCode = :shareCode",
      ExpressionAttributeValues: {
        ":shareCode": shareCode,
      },
    };

    const queryResult = await dynamoDb.query(queryParams).promise();
    if (queryResult.Items.length === 0) {
      return respondWithError(404, "Share link not found.");
    }

    const shareLink = queryResult.Items[0];
    
    // Check if the share link has expired
    if (shareLink.expiresAt && new Date(shareLink.expiresAt) < new Date()) {
      return respondWithError(410, "This share link has expired.");
    }

    // Check if password is required and provided
    if (shareLink.password) {
      if (!password) {
        return respondWithError(401, "Password is required to access this shared item.");
      }
      
      if (password !== shareLink.password) {
        return respondWithError(401, "Incorrect password.");
      }
    }

    // Get the resource details
    const resourceTableMap = {
      file: process.env.FILES_TABLE_NAME,
      folder: process.env.FOLDERS_TABLE_NAME,
      photo: process.env.PHOTOS_TABLE_NAME,
      album: process.env.ALBUMS_TABLE_NAME,
      resume: process.env.RESUME_VERSIONS_TABLE_NAME,
    };

    const resourceTableName = resourceTableMap[shareLink.resourceType];
    if (!resourceTableName) {
      log.error(`Environment variable for ${shareLink.resourceType} table is not set.`);
      return respondWithError(500, "Server configuration error.");
    }

    const resourceParams = {
      TableName: resourceTableName,
      Key: { id: shareLink.resourceId },
    };

    const resourceResult = await dynamoDb.get(resourceParams).promise();
    if (!resourceResult.Item) {
      return respondWithError(404, `${shareLink.resourceType.charAt(0).toUpperCase() + shareLink.resourceType.slice(1)} not found.`);
    }

    const resource = resourceResult.Item;

    // Generate a presigned URL for accessing the resource if it's a file, photo, or resume
    let presignedUrl = null;
    if (['file', 'photo', 'resume'].includes(shareLink.resourceType)) {
      const bucketMap = {
        file: process.env.FILES_BUCKET_NAME,
        photo: process.env.PHOTOS_BUCKET_NAME,
        resume: process.env.RESUMES_BUCKET_NAME,
      };

      const bucketName = bucketMap[shareLink.resourceType];
      if (!bucketName) {
        log.error(`Environment variable for ${shareLink.resourceType} bucket is not set.`);
        return respondWithError(500, "Server configuration error.");
      }

      // Generate a presigned URL for viewing or downloading the resource
      const s3Params = {
        Bucket: bucketName,
        Key: resource.s3Key,
        Expires: 3600, // URL expires in 1 hour
      };

      // If download is allowed and requested, set content disposition to attachment
      if (shareLink.allowDownload && event.queryStringParameters && event.queryStringParameters.download === 'true') {
        s3Params.ResponseContentDisposition = `attachment; filename="${resource.fileName}"`;
      }

      presignedUrl = s3.getSignedUrl("getObject", s3Params);
    }

    // Increment the access count
    const updateParams = {
      TableName: shareLinksTableName,
      Key: { id: shareLink.id },
      UpdateExpression: "set accessCount = accessCount + :increment, updatedAt = :updatedAt",
      ExpressionAttributeValues: {
        ":increment": 1,
        ":updatedAt": new Date().toISOString(),
      },
    };

    await dynamoDb.update(updateParams).promise();

    // Return the share link and resource details
    const response = {
      shareLink: {
        id: shareLink.id,
        shareCode: shareLink.shareCode,
        resourceType: shareLink.resourceType,
        resourceId: shareLink.resourceId,
        expiresAt: shareLink.expiresAt,
        allowDownload: shareLink.allowDownload,
        accessCount: shareLink.accessCount + 1,
        createdAt: shareLink.createdAt,
      },
      resource: resource,
    };

    // Add the presigned URL if generated
    if (presignedUrl) {
      response.presignedUrl = presignedUrl;
    }

    log.info("Shared item accessed successfully", { shareCode, resourceType: shareLink.resourceType, resourceId: shareLink.resourceId });
    return respondWithSuccess(200, response);

  } catch (error) {
    log.error("Error accessing shared item", { error: error.message, stack: error.stack });
    if (error instanceof SyntaxError) {
      return respondWithError(400, "Invalid JSON payload.");
    }
    return respondWithError(500, "Could not access shared item. Please try again later.");
  }
};
