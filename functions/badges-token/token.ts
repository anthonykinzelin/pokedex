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
export const handler: Handler<RegisterTokenEvent, void> = async (event, context) => {
  const log = createLogger({
    route: 'badges-token',
    requestId: context?.awsRequestId,
  });

  const { userId } = requireStrings(event, ['userId']);
  const level = requireInteger(event.level, 'level', { min: 1 });
  // Checked separately, with an explicit ceiling. requireStrings applies
  // requireString's default of 200 characters, which is right for a name a
  // person typed and wrong for a callback token - a real token is roughly 900
  // characters, so the default rejected every single one and failed the task.
  const taskToken = requireString(event.taskToken, 'taskToken', {
    max: MAX_TASK_TOKEN_LENGTH,
  });

  try {
    await updateItem(TABLE_NAME, `USER#${userId}`, badgeSortKey(level), {
      // A plain SET, so a Step Functions retry of this task can overwrite the
      // value safely: whichever token was registered last is the live one, and
      // any earlier token is already dead.
      UpdateExpression: 'SET taskToken = :taskToken, tokenRegisteredAt = :now',
      // Refuses to arm a badge that no longer exists or has already been
      // decided. Without it, an execution started long after a decision - the
      // execution-name uniqueness Step Functions guarantees only lasts 90 days -
      // could reopen a settled badge.
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
      // Thrown so the task fails and the execution stops rather than pausing on
      // a token nobody will ever redeem. It surfaces as a failed execution in
      // the console, which is exactly what we want to be able to see. Not an
      // HttpError: nothing here is behind an API, so a status code would be a
      // lie about where the failure happened.
      throw new Error(`Badge for level ${level} is not waiting for a decision.`);
    }

    throw error;
  }

  // The token itself is never logged. It is a bearer credential: whoever holds
  // it can resume the execution, so it stays out of CloudWatch.
  log.info('Registered the callback token.', { userId, level, badgeId: event.badgeId });
};
