const test = require('node:test');
const assert = require('node:assert/strict');
const { HttpError, errorResponse, jsonResponse, parseJsonBody } = require('pokedex-utils');

// Silent logger, so a passing test run stays readable.
const quiet = { debug() {}, info() {}, warn() {}, error() {}, child: () => quiet };

test('parseJsonBody requires a body', () => {
  assert.throws(() => parseJsonBody({}), /body is required/);
});

test('parseJsonBody distinguishes malformed JSON from a non-object', () => {
  // These used to collapse into one generic message because the try block
  // wrapped both the parse and the shape check.
  assert.throws(() => parseJsonBody({ body: '{' }), /must be valid JSON/);
  assert.throws(() => parseJsonBody({ body: '[]' }), /must be a JSON object/);
  assert.throws(() => parseJsonBody({ body: 'null' }), /must be a JSON object/);
  assert.throws(() => parseJsonBody({ body: '"a string"' }), /must be a JSON object/);
});

test('parseJsonBody decodes a base64 body', () => {
  const body = Buffer.from('{"name":"Ash"}').toString('base64');
  assert.deepEqual(parseJsonBody({ body, isBase64Encoded: true }), { name: 'Ash' });
});

test('errorResponse merges HttpError details into the body', () => {
  // This is what carries the existing userId in a duplicate-name 409.
  const response = errorResponse(new HttpError(409, 'taken', { userId: 'u1' }), quiet);
  assert.equal(response.statusCode, 409);
  assert.deepEqual(JSON.parse(response.body), { message: 'taken', userId: 'u1' });
});

test('errorResponse tolerates an HttpError with no details', () => {
  const response = errorResponse(new HttpError(404, 'nope'), quiet);
  assert.deepEqual(JSON.parse(response.body), { message: 'nope' });
});

test('errorResponse maps a failed conditional write to 409', () => {
  const error = Object.assign(new Error('x'), { name: 'ConditionalCheckFailedException' });
  assert.equal(errorResponse(error, quiet).statusCode, 409);
});

test('errorResponse hides an unexpected error behind a 500', () => {
  const response = errorResponse(new Error('boom'), quiet);
  assert.equal(response.statusCode, 500);
  assert.deepEqual(JSON.parse(response.body), { message: 'Internal server error.' });
});

test('jsonResponse can add headers, as the 405 does', () => {
  const response = jsonResponse(405, { message: 'no' }, { allow: 'GET, POST' });
  assert.equal(response.headers.allow, 'GET, POST');
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
});
