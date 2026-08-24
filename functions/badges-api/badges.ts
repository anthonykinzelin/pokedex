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
      // One query on the table's own key. Every badge of a user shares this
      // sort-key prefix, which is the reason a single-table design puts related
      // items under the same partition key: no index needed to list them.
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
          // Read, but never returned - see the mapping below. The distinction
          // matters: reading it inside the function is harmless, returning it
          // would hand a bearer credential to every holder of pokedex/read.
          'taskToken',
        ].join(', '),
        // `level` and `status` are both DynamoDB reserved words, so neither can
        // appear literally in an expression.
        ExpressionAttributeNames: { '#level': 'level', '#status': 'status' },
      },
    );

    return jsonResponse(200, {
      userId,
      // The query returns items in sort-key order, which is a *string* order:
      // BADGE#LEVEL#10 sorts before BADGE#LEVEL#2. Sorted numerically here so
      // the response reads in the order the levels were reached.
      badges: badges
        .sort((a, b) => (a.level || 0) - (b.level || 0))
        .map(({ taskToken, ...badge }) => ({
          ...badge,
          // Whether the workflow has registered its callback token yet, which
          // is what makes a decision possible. There is a real window where a
          // badge is PENDING but not yet decidable: the consumer writes the
          // badge, starts the execution, and only then does the task store its
          // token. A client that polls tightly would otherwise get a 409 from
          // the decision route and have no way to tell why.
          //
          // The boolean is derived and returned; the token itself is destructured
          // out and never leaves this function.
          awaitingDecision: badge.status === 'PENDING' && Boolean(taskToken),
        })),
    });
  } catch (error) {
    return errorResponse(error, log);
  }
};
