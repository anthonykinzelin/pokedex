import type { Handler } from 'aws-lambda';
import {
  MAX_TASK_TOKEN_LENGTH,
  badgeSortKey,
  createLogger,
  isErrorNamed,
  requireEnv,
  requireInteger,
  requireString,
  requireStrings,
  updateItem,
} from 'pokedex-utils';

const TABLE_NAME = requireEnv('TABLE_NAME');

interface RegisterTokenEvent {
  userId: string;
  level: number;
  badgeId: string;
  taskToken: string;
}

// The most counter-intuitive function in the project, and the one the brief
// spends a paragraph on. Step Functions invokes it with a callback token and
// then *pauses* the execution: this handler's return value is discarded, and
// the workflow will not move until somebody calls SendTaskSuccess with that
// token. Its only job is to make the token findable later.
//
// The ordering is imposed and cannot be worked around: the execution starts,
// the task is invoked with a token, the task stores it, the execution pauses.
// There is no token to store before the execution exists. And the decision will
// arrive on a different function, possibly days later, in a container that has
// no memory of this one - so "somewhere" has to mean the table.
//
// taskToken is checked with an explicit ceiling: requireString's 200-character
// default is right for a name a person typed and wrong for a real token of
// roughly 900 characters. The update is a plain SET, so a Step Functions retry
// safely overwrites - the last token registered is the live one - and its
// condition refuses to arm a badge that no longer exists or was already decided,
// which an execution started long after a decision could otherwise reopen once
// the 90-day execution-name uniqueness has lapsed. The token itself is never
// logged: whoever holds it can resume the execution.
export const handler: Handler<RegisterTokenEvent, void> = async (event, context) => {
  const log = createLogger({
    route: 'badges-token',
    requestId: context?.awsRequestId,
  });

  const { userId } = requireStrings(event, ['userId']);
  const level = requireInteger(event.level, 'level', { min: 1 });
  const taskToken = requireString(event.taskToken, 'taskToken', {
    max: MAX_TASK_TOKEN_LENGTH,
  });

  try {
    await updateItem(TABLE_NAME, `USER#${userId}`, badgeSortKey(level), {
      UpdateExpression: 'SET taskToken = :taskToken, tokenRegisteredAt = :now',
      ConditionExpression: 'attribute_exists(PK) AND #status = :pending',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':taskToken': taskToken,
        ':now': new Date().toISOString(),
        ':pending': 'PENDING',
      },
    });
  } catch (error) {
    if (isErrorNamed(error, 'ConditionalCheckFailedException')) {
      throw new Error(`Badge for level ${level} is not waiting for a decision.`);
    }

    throw error;
  }

  log.info('Registered the callback token.', { userId, level, badgeId: event.badgeId });
};
