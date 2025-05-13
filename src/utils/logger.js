const LOG_LEVEL = process.env.LOG_LEVEL || "info"; // Default to info

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  verbose: 4,
};

const currentLevel = levels[LOG_LEVEL.toLowerCase()] !== undefined ? levels[LOG_LEVEL.toLowerCase()] : levels.info;

function formatMessage(level, message, context = {}) {
  const timestamp = new Date().toISOString();
  let logEntry = `${timestamp} [${level.toUpperCase()}] - ${message}`;
  if (Object.keys(context).length > 0) {
    try {
      logEntry += ` - Context: ${JSON.stringify(context, null, 2)}`;
    } catch (e) {
      // Fallback if context cannot be stringified (e.g., circular references)
      logEntry += ` - Context: [Unserializable]`;
    }
  }
  return logEntry;
}

const logger = {
  log: (message, context) => { // Generic log, defaults to info level
    if (levels.info <= currentLevel) {
      console.log(formatMessage("info", message, context));
    }
  },
  info: (message, context) => {
    if (levels.info <= currentLevel) {
      console.info(formatMessage("info", message, context));
    }
  },
  warn: (message, context) => {
    if (levels.warn <= currentLevel) {
      console.warn(formatMessage("warn", message, context));
    }
  },
  error: (message, context) => {
    if (levels.error <= currentLevel) {
      console.error(formatMessage("error", message, context));
    }
  },
  debug: (message, context) => {
    if (levels.debug <= currentLevel) {
      console.debug(formatMessage("debug", message, context));
    }
  },
  verbose: (message, context) => {
    if (levels.verbose <= currentLevel) {
      console.log(formatMessage("verbose", message, context)); // console.verbose is not standard
    }
  },
};

module.exports = logger;
// For convenience, also export the generic log function directly
module.exports.log = logger.log;
