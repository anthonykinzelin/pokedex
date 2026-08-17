class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
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

  try {
    const body = JSON.parse(rawBody);
    if (!body || Array.isArray(body) || typeof body !== 'object') {
      throw new Error('Body is not an object');
    }
    return body;
  } catch (error) {
    throw new HttpError(400, 'The request body must be a valid JSON object.');
  }
}

function errorResponse(error) {
  if (error instanceof HttpError) {
    return jsonResponse(error.statusCode, { message: error.message });
  }

  if (error?.name === 'ConditionalCheckFailedException') {
    return jsonResponse(409, { message: 'The resource already exists.' });
  }

  console.error(error);
  return jsonResponse(500, { message: 'Internal server error.' });
}

module.exports = {
  HttpError,
  errorResponse,
  jsonResponse,
  parseJsonBody,
};
