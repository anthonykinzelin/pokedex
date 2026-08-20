// Structured logging with no dependency. One JSON object per line, so
// CloudWatch Logs Insights can filter on any field.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] || LEVELS.info;

// JSON.stringify ignores an Error: name, message and stack are not enumerable
// properties, so an error has to be flattened by hand before it can be logged.
function serializeError(error) {
  return {
    errorName: error?.name,
    errorMessage: error?.message,
    stack: error?.stack,
  };
}

function write(level, message, context, base) {
  if (LEVELS[level] < MIN_LEVEL) {
    return;
  }

  // JSON.stringify escapes the newlines inside a stack trace, so the record
  // stays on a single physical line and CloudWatch keeps it as one event.
  const line = JSON.stringify({
    level,
    message,
    ...base,
    ...context,
    timestamp: new Date().toISOString(),
  });

  if (level === 'error' || level === 'warn') {
    console.error(line);
  } else {
    console.log(line);
  }
}

function createLogger(base = {}) {
  return {
    debug: (message, context) => write('debug', message, context, base),
    info: (message, context) => write('info', message, context, base),
    warn: (message, context) => write('warn', message, context, base),
    error: (message, context) => write('error', message, context, base),
    child: (extra) => createLogger({ ...base, ...extra }),
  };
}

module.exports = { createLogger, logger: createLogger(), serializeError };
