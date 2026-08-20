import type { APIGatewayProxyHandler } from 'aws-lambda';
import {
  createLogger,
  errorResponse,
  getItem,
  jsonResponse,
  requireEnv,
  requireString,
} from 'pokedex-utils';

const TABLE_NAME = requireEnv('TABLE_NAME');

// Only the attributes this route reads back. The consumer owns the rest of the
// item, so naming them here would be a second, drifting definition.
interface LevelItem {
  points?: number;
  level?: number;
  updatedAt?: string;
}

export const handler: APIGatewayProxyHandler = async (event, context) => {
  const log = createLogger({
    route: 'levels-api',
    requestId: context?.awsRequestId,
    apiRequestId: event.requestContext?.requestId,
  });

  try {
    // Thrown, not returned: every error body in the API is built by
    // errorResponse, so this 400 gets the same shape and logging as the rest.
    const userId = requireString(event.pathParameters?.userId, 'userId');

    const item = await getItem<LevelItem>(TABLE_NAME, `USER#${userId}`, 'LEVEL');

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
