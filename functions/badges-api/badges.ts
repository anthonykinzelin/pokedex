import type { APIGatewayProxyHandler } from 'aws-lambda';
import {
  BADGE_SK_PREFIX,
  createLogger,
  errorResponse,
  jsonResponse,
  queryAllByPK,
  requireEnv,
  requireString,
  type BadgeStatus,
} from 'pokedex-utils';

const TABLE_NAME = requireEnv('TABLE_NAME');

interface BadgeItem {
  badgeId?: string;
  level?: number;
  badgeCode?: string;
  badgeLabel?: string;
  status?: BadgeStatus;
  points?: number;
  reachedAt?: string;
  createdAt?: string;
  decidedAt?: string;
  decisionReason?: string;
  taskToken?: string;
}

// One query on the table's own key: every badge of a user shares the same
// sort-key prefix, so no index is needed to list them. taskToken is read but
// never returned - the boolean derived from it says whether the workflow has
// registered its callback token, which is what makes a decision possible.
// Without it a client polling tightly would get a 409 from the decision route
// with no way to tell why, because a badge is briefly PENDING before its task
// has stored the token. Returning the token itself would hand a bearer
// credential to every holder of pokedex/read. `level` and `status` are DynamoDB
// reserved words, hence the expression names, and the numeric sort undoes the
// string order of the sort key, where BADGE#LEVEL#10 comes before BADGE#LEVEL#2.
export const handler: APIGatewayProxyHandler = async (event, context) => {
  const log = createLogger({
    route: 'badges-api',
    requestId: context?.awsRequestId,
    apiRequestId: event.requestContext?.requestId,
  });

  try {
    const userId = requireString(event.pathParameters?.userId, 'userId');

    const badges = await queryAllByPK<BadgeItem>(
      TABLE_NAME,
      `USER#${userId}`,
      BADGE_SK_PREFIX,
      {
        ProjectionExpression: [
          'badgeId',
          '#level',
          'badgeCode',
          'badgeLabel',
          '#status',
          'points',
          'reachedAt',
          'createdAt',
          'decidedAt',
          'decisionReason',
          'taskToken',
        ].join(', '),
        ExpressionAttributeNames: { '#level': 'level', '#status': 'status' },
      },
    );

    return jsonResponse(200, {
      userId,
      badges: badges
        .sort((a, b) => (a.level || 0) - (b.level || 0))
        .map(({ taskToken, ...badge }) => ({
          ...badge,
          awaitingDecision: badge.status === 'PENDING' && Boolean(taskToken),
        })),
    });
  } catch (error) {
    return errorResponse(error, log);
  }
};
