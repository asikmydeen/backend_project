const log = require("./logger").log;

const buildResponse = (statusCode, body, headers = {}) => {
  return {
    statusCode: statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*", // Allow all origins
      "Access-Control-Allow-Headers": "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
      "Access-Control-Allow-Methods": "OPTIONS,POST,GET,PUT,PATCH,DELETE", // Allow all common methods
      ...headers,
    },
    body: JSON.stringify(body),
  };
};

module.exports = {
  _200: (data = {}, message = "Success") => {
    log("Response 200", { data, message });
    return buildResponse(200, { status: "success", message, data });
  },
  _201: (data = {}, message = "Created") => {
    log("Response 201", { data, message });
    return buildResponse(201, { status: "success", message, data });
  },
  _204: (message = "No Content") => {
    log("Response 204", { message });
    // 204 should not have a body, but API Gateway might still send one if stringified null/undefined
    return {
        statusCode: 204,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
            "Access-Control-Allow-Methods": "OPTIONS,POST,GET,PUT,PATCH,DELETE",
        },
        body: "" // Explicitly empty body
    };
  },
  _400: (errorData = {}, message = "Bad Request") => {
    log("Response 400", { errorData, message });
    return buildResponse(400, { status: "error", message, error: errorData });
  },
  _401: (errorData = {}, message = "Unauthorized") => {
    log("Response 401", { errorData, message });
    return buildResponse(401, { status: "error", message, error: errorData });
  },
  _403: (errorData = {}, message = "Forbidden") => {
    log("Response 403", { errorData, message });
    return buildResponse(403, { status: "error", message, error: errorData });
  },
  _404: (errorData = {}, message = "Not Found") => {
    log("Response 404", { errorData, message });
    return buildResponse(404, { status: "error", message, error: errorData });
  },
  _500: (errorData = {}, message = "Internal Server Error") => {
    log("Response 500", { errorData, message });
    return buildResponse(500, { status: "error", message, error: errorData });
  },
  buildResponse, // Export for custom responses if needed
};
