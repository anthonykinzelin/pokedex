const {
  createLogger,
  errorResponse,
  getItem,
  jsonResponse,
  requireString,
} = require('pokedex-utils');

const TABLE_NAME = process.env.TABLE_NAME;

exports.handler = async (event, context) => {
  const log = createLogger({
    route: 'levels-api',
    requestId: context?.awsRequestId,
    apiRequestId: event.requestContext?.requestId,
  });

  try {
    // Thrown, not returned: every error body in the API is built by
    // errorResponse, so this 400 gets the same shape and logging as the rest.
    const userId = requireString(event.pathParameters?.userId, 'userId');

    const item = await getItem(TABLE_NAME, `USER#${userId}`, 'LEVEL');

    return jsonResponse(200, {
      userId,
      points: item?.points || 0,
      level: item?.level || 0,
      updatedAt: item?.updatedAt || null,
    });
  } catch (error) {
    return errorResponse(error, log);
  }
};
