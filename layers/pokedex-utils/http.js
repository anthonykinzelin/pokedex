const { logger, serializeError } = require('./logger');

class HttpError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    // Extra fields merged into the response body, for example the userId that
    // already owns a name in a 409.
    this.details = details;
  }
}

function jsonResponse(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

function parseJsonBody(event) {
  if (!event.body) {
    throw new HttpError(400, 'A JSON request body is required.');
  }

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;

  let body;
  try {
    // Only JSON.parse belongs inside the try. A wider try would relabel every
    // error thrown below it as "invalid JSON", including a genuine bug.
    body = JSON.parse(rawBody);
  } catch (error) {
    throw new HttpError(400, 'The request body must be valid JSON.');
  }

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'The request body must be a JSON object.');
  }

  return body;
}

// The single place where an error becomes a response, so every error body in
// the API has the same shape.
function errorResponse(error, log = logger) {
  if (error instanceof HttpError) {
    if (error.statusCode >= 500) {
      log.error('Request failed.', { statusCode: error.statusCode, ...serializeError(error) });
    } else {
      log.warn('Request rejected.', { statusCode: error.statusCode, message: error.message });
    }

    return jsonResponse(error.statusCode, { message: error.message, ...error.details });
  }

  // Raised by a conditional PutItem, unlike a cancelled transaction which
  // raises TransactionCanceledException.
  if (error?.name === 'ConditionalCheckFailedException') {
    log.warn('Conditional write failed.', serializeError(error));
    return jsonResponse(409, { message: 'The resource already exists.' });
  }

  log.error('Unhandled error.', serializeError(error));
  return jsonResponse(500, { message: 'Internal server error.' });
}

module.exports = { HttpError, errorResponse, jsonResponse, parseJsonBody };
