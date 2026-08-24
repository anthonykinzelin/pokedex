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

// Only the attributes this route reads back. The consumer owns the rest of the
// item, so naming them here would be a second, drifting definition.
interface LevelItem {
  points?: number;
  publishedLevel?: number;
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
      // Computed here rather than read from the item, with the same helper the
      // consumer uses. The level is a function of the points, so storing it
      // would only create a second value that can disagree with the first.
      level: levelFor(item?.points),
      // What Badges has been told about, which can lag the level above by one
      // while an event is still in flight. Exposed because it is the difference
      // between "no badge yet" and "the badge is genuinely missing".
      publishedLevel: item?.publishedLevel || 0,
      updatedAt: item?.updatedAt || null,
    });
  } catch (error) {
    return errorResponse(error, log);
  }
};
