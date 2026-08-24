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

// Only what this route reads. The state machine owns the rest of the item.
interface BadgeItem {
  status?: BadgeStatus;
  taskToken?: string;
}

// The token no longer accepts a result. Three different names, one meaning:
// somebody or something already settled this badge.
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

export const handler: APIGatewayProxyHandler = async (event, context) => {
  const log = createLogger({
    route: 'badges-decision',
    requestId: context?.awsRequestId,
    apiRequestId: event.requestContext?.requestId,
  });

  try {
    const userId = requireString(event.pathParameters?.userId, 'userId');
    // Turns `lvl-2` back into 2, or 400s. The level is what identifies the item.
    const level = levelFromBadgeId(event.pathParameters?.badgeId);

    const body = parseJsonBody(event);
    // A stale client sending `status` or `decidedBy` fails loudly instead of
    // having the field silently dropped.
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
      // The badge exists but its workflow has not registered its token yet. A
      // narrow window - the consumer writes the badge, then starts the
      // execution, then the task stores the token - but a client that polls
      // GET /badges tightly can land in it. Retryable, so it is not a 404.
      throw new HttpError(409, `Badge ${badgeIdFor(level)} is not ready for a decision yet.`);
    }

    try {
      // A refusal travels through SendTaskSuccess, never SendTaskFailure. A
      // refused badge is a perfectly normal result: the decision goes in the
      // payload and the Choice state routes on it. Reporting it as a task
      // failure would fire the state machine's Retry and Catch, which makes no
      // sense at all for an outcome somebody deliberately chose.
      await sendTaskSuccess(badge.taskToken, {
        decision,
        // Always a string, never null. The state machine writes this straight
        // into a DynamoDB AttributeValue of type S, and {"S": null} is not a
        // valid attribute value - it would fail the write, not the validation.
        reason: reason ?? '',
        decidedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (SETTLED_TOKEN_ERRORS.some((name) => isErrorNamed(error, name))) {
        // Two people deciding at the same time, or a decision arriving just
        // after the timeout fired. The second caller is not a malfunction, so
        // this is a 409 and not a 500.
        log.warn('The callback token was no longer waiting.', { userId, level });
        throw new HttpError(409, `Badge ${badgeIdFor(level)} was already decided or has expired.`);
      }

      throw error;
    }

    // 202, not 200: the decision has been accepted but the badge has not
    // changed yet. It is the state machine that writes the new status, a moment
    // later. Claiming 200 here would be claiming work that has not happened.
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
