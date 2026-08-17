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
      return {};
    }
  
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;
  
    try {
      return JSON.parse(rawBody);
    } catch (error) {
      const parseError = new Error('The request body must be valid JSON.');
      parseError.name = 'InvalidJsonError';
      throw parseError;
    }
  }
  
  function getJwtClaims(event) {
    return event.requestContext?.authorizer?.jwt?.claims || {};
  }
  
  function getUserId(event) {
    const claims = getJwtClaims(event);
    const userId = claims.client_id || claims.sub;
  
    if (!userId) {
      const authError = new Error('No client_id or sub claim was found in the JWT.');
      authError.name = 'UnauthorizedError';
      throw authError;
    }
  
    return String(userId);
  }
  
  function getHeader(event, headerName) {
    const expected = headerName.toLowerCase();
    const headers = event.headers || {};
  
    for (const [name, value] of Object.entries(headers)) {
      if (name.toLowerCase() === expected) {
        return value;
      }
    }
  
    return undefined;
  }
  
  module.exports = {
    getHeader,
    getJwtClaims,
    getUserId,
    jsonResponse,
    parseJsonBody,
  };