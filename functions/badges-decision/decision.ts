import type { APIGatewayProxyHandler } from 'aws-lambda';
import {
  HttpError,
  ValidationError,
  badgeIdFor,
  badgeSortKey,
  createLogger,
  errorResponse,
  getItem,
  isErrorNamed,
  jsonResponse,
  levelFromBadgeId,
  parseJsonBody,
  rejectUnknownFields,
  requireEnv,
  requireString,
  sendTaskSuccess,
  type BadgeStatus,
} from 'pokedex-utils';

const TABLE_NAME = requireEnv('TABLE_NAME');

const DECISIONS = ['GRANTED', 'REFUSED'] as const;
type Decision = (typeof DECISIONS)[number];

interface BadgeItem {
  status?: BadgeStatus;
  taskToken?: string;
}

const SETTLED_TOKEN_ERRORS = ['TaskTimedOut', 'TaskDoesNotExist', 'InvalidToken'];

function requireDecision(value: unknown): Decision {
  const decision = requireString(value, 'decision');

  if (!DECISIONS.includes(decision as Decision)) {
    throw new ValidationError(
      `decision must be one of: ${DECISIONS.join(', ')}.`,
      'decision',
    );
  }

  return decision as Decision;
}

// A refusal travels through SendTaskSuccess, never SendTaskFailure: a refused
// badge is a normal result, the decision goes in the payload and the Choice state
// routes on it, whereas a task failure would fire the state machine's Retry and
// Catch for an outcome somebody deliberately chose. The three SETTLED_TOKEN_ERRORS
// all mean the same thing - something already settled this badge - so they answer
// 409 rather than 500. A badge with no token yet is also a 409, not a 404: it is
// retryable, and a client polling GET /badges tightly can land in the window
// between the consumer starting the execution and the task storing its token.
// The response is 202 because the state machine, not this handler, writes the new
// status a moment later.
export const handler: APIGatewayProxyHandler = async (event, context) => {
  const log = createLogger({
    route: 'badges-decision',
    requestId: context?.awsRequestId,
    apiRequestId: event.requestContext?.requestId,
  });

  try {
    const userId = requireString(event.pathParameters?.userId, 'userId');
    const level = levelFromBadgeId(event.pathParameters?.badgeId);

    const body = parseJsonBody(event);
    rejectUnknownFields(body, ['decision', 'reason']);
    const decision = requireDecision(body.decision);
    const reason = body.reason === undefined || body.reason === null
      ? null
      : requireString(body.reason, 'reason', { max: 500 });

    const badge = await getItem<BadgeItem>(
      TABLE_NAME,
      `USER#${userId}`,
      badgeSortKey(level),
    );

    if (!badge) {
      throw new HttpError(404, `Badge ${badgeIdFor(level)} was not found for user ${userId}.`);
    }
    if (badge.status !== 'PENDING') {
      throw new HttpError(409, `Badge ${badgeIdFor(level)} was already decided.`, {
        status: badge.status,
      });
    }
    if (!badge.taskToken) {
      throw new HttpError(409, `Badge ${badgeIdFor(level)} is not ready for a decision yet.`);
    }

    try {
      await sendTaskSuccess(badge.taskToken, {
        decision,
        reason: reason ?? '',
        decidedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (SETTLED_TOKEN_ERRORS.some((name) => isErrorNamed(error, name))) {
        log.warn('The callback token was no longer waiting.', { userId, level });
        throw new HttpError(409, `Badge ${badgeIdFor(level)} was already decided or has expired.`);
      }

      throw error;
    }

    return jsonResponse(202, {
      badgeId: badgeIdFor(level),
      userId,
      level,
      decision,
      reason,
      message: 'The decision was accepted and is being applied by the workflow.',
    });
  } catch (error) {
    return errorResponse(error, log);
  }
};
