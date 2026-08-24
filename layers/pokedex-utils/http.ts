import type { APIGatewayProxyResult } from 'aws-lambda';
import { isErrorNamed } from './errors';
import { logger, serializeError, type Logger } from './logger';

// `details` is merged into the response body, for example the userId that
// already owns a name in a 409.
export class HttpError extends Error {
  statusCode: number;

  details?: Record<string, unknown>;

  constructor(statusCode: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function jsonResponse(
  statusCode: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): APIGatewayProxyResult {
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

export interface JsonBodyEvent {
  body?: string | null;
  isBase64Encoded?: boolean;
}

// Only JSON.parse sits inside the try: a wider try would relabel every error
// thrown below it as "invalid JSON", including a genuine bug.
export function parseJsonBody<T = Record<string, unknown>>(event: JsonBodyEvent): T {
  if (!event.body) {
    throw new HttpError(400, 'A JSON request body is required.');
  }

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    throw new HttpError(400, 'The request body must be valid JSON.');
  }

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'The request body must be a JSON object.');
  }

  return body as T;
}

// The single place where an error becomes a response, so every error body in the
// API has the same shape. ConditionalCheckFailedException is what a conditional
// PutItem raises, unlike a cancelled transaction which raises
// TransactionCanceledException.
export function errorResponse(error: unknown, log: Logger = logger): APIGatewayProxyResult {
  if (error instanceof HttpError) {
    if (error.statusCode >= 500) {
      log.error('Request failed.', { statusCode: error.statusCode, ...serializeError(error) });
    } else {
      log.warn('Request rejected.', { statusCode: error.statusCode, message: error.message });
    }

    return jsonResponse(error.statusCode, { message: error.message, ...error.details });
  }

  if (isErrorNamed(error, 'ConditionalCheckFailedException')) {
    log.warn('Conditional write failed.', serializeError(error));
    return jsonResponse(409, { message: 'The resource already exists.' });
  }

  log.error('Unhandled error.', serializeError(error));
  return jsonResponse(500, { message: 'Internal server error.' });
}
