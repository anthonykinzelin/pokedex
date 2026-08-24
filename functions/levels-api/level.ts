import type { APIGatewayProxyHandler } from 'aws-lambda';
import {
  createLogger,
  errorResponse,
  getItem,
  jsonResponse,
  levelFor,
  requireEnv,
  requireString,
} from 'pokedex-utils';

const TABLE_NAME = requireEnv('TABLE_NAME');

interface LevelItem {
  points?: number;
  publishedLevel?: number;
  updatedAt?: string;
}

// The level is computed with the same helper the consumer uses rather than read
// from the item: it is a function of the points, so storing it would only create
// a second value that can disagree. publishedLevel is what Badges has been told
// about and can lag the level by one while an event is in flight - it is exposed
// because it is the difference between "no badge yet" and "the badge is genuinely
// missing". The 400 is thrown, not returned, so errorResponse gives it the same
// shape and logging as every other error in the API.
export const handler: APIGatewayProxyHandler = async (event, context) => {
  const log = createLogger({
    route: 'levels-api',
    requestId: context?.awsRequestId,
    apiRequestId: event.requestContext?.requestId,
  });

  try {
    const userId = requireString(event.pathParameters?.userId, 'userId');

    const item = await getItem<LevelItem>(TABLE_NAME, `USER#${userId}`, 'LEVEL');

    return jsonResponse(200, {
      userId,
      points: item?.points || 0,
      level: levelFor(item?.points),
      publishedLevel: item?.publishedLevel || 0,
      updatedAt: item?.updatedAt || null,
    });
  } catch (error) {
    return errorResponse(error, log);
  }
};
