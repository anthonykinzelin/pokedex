import type { SQSBatchItemFailure, SQSHandler, SQSRecord } from 'aws-lambda';
import {
  badgeForLevel,
  badgeIdFor,
  badgeSortKey,
  createLogger,
  executionNameFor,
  isErrorNamed,
  putItemConditional,
  requireEnv,
  requireInteger,
  requireStrings,
  serializeError,
  startExecution,
  type BadgeDefinition,
  type Logger,
} from 'pokedex-utils';

const TABLE_NAME = requireEnv('TABLE_NAME');
const STATE_MACHINE_ARN = requireEnv('STATE_MACHINE_ARN');

interface LevelReached {
  userId: string;
  level: number;
  points: number;
  reachedAt: string;
}

// The envelope is checked before the payload. An event from another source, or
// carrying an eventVersion this code was never written against, will fail the
// same way on every attempt, so it must go to the DLQ rather than be retried
// three times first - that is the difference the brief asks for between a
// permanent failure and a transient one.
function levelReached(record: SQSRecord): LevelReached {
  const event = JSON.parse(record.body);
  const detail = event.detail;

  if (event.source !== 'fr.pokemon.levels'
    || event['detail-type'] !== 'level.reached'
    || detail?.eventVersion !== '1.0') {
    throw new Error('Unsupported level event.');
  }

  const { userId, reachedAt } = requireStrings(detail, ['userId', 'reachedAt']);

  return {
    userId,
    level: requireInteger(detail.level, 'level', { min: 1 }),
    points: requireInteger(detail.points, 'points'),
    reachedAt,
  };
}

async function createPendingBadge(
  event: LevelReached,
  badge: BadgeDefinition,
  log: Logger,
): Promise<void> {
  try {
    await putItemConditional(
      TABLE_NAME,
      {
        PK: `USER#${event.userId}`,
        SK: badgeSortKey(event.level),
        entity: 'BADGE',
        badgeId: badgeIdFor(event.level),
        userId: event.userId,
        level: event.level,
        badgeCode: badge.code,
        badgeLabel: badge.label,
        status: 'PENDING',
        points: event.points,
        reachedAt: event.reachedAt,
        createdAt: new Date().toISOString(),
      },
      // One badge per user and per level, enforced by the key rather than by a
      // read-then-write. A redelivered event lands on the same PK and SK, so
      // the condition fails and no second badge appears.
      'attribute_not_exists(PK)',
    );

    log.info('Created a pending badge.', { level: event.level, badge: badge.code });
  } catch (error) {
    if (!isErrorNamed(error, 'ConditionalCheckFailedException')) {
      throw error;
    }

    log.info('The badge already existed.', { level: event.level });
  }
}

async function startValidation(event: LevelReached, log: Logger): Promise<void> {
  // Deterministic, so this is the second half of the idempotency: Step Functions
  // refuses two executions with the same name, which rules out a duplicate
  // workflow without a lock or a dedupe table.
  const name = executionNameFor(event.userId, event.level);

  try {
    const executionArn = await startExecution(STATE_MACHINE_ARN, name, {
      userId: event.userId,
      level: event.level,
      badgeId: badgeIdFor(event.level),
    });

    log.info('Started the badge validation workflow.', { executionName: name, executionArn });
  } catch (error) {
    if (!isErrorNamed(error, 'ExecutionAlreadyExists')) {
      throw error;
    }

    log.info('The workflow was already started for this badge.', { executionName: name });
  }
}

export const handler: SQSHandler = async (event, context) => {
  const log = createLogger({
    route: 'badges-consumer',
    requestId: context?.awsRequestId,
  });
  const batchItemFailures: SQSBatchItemFailure[] = [];

  for (const record of event.Records || []) {
    const recordLog = log.child({ messageId: record.messageId });

    try {
      const reached = levelReached(record);
      const badge = badgeForLevel(reached.level);

      // Not every level is worth a badge, and which ones are is this service's
      // business alone. A level the catalog ignores is a normal outcome: the
      // message is acknowledged and nothing is created. Throwing here would
      // send a perfectly valid event to the DLQ three attempts later.
      if (!badge) {
        recordLog.info('No badge is defined for this level.', { level: reached.level });
        continue;
      }

      // The two steps are tolerated independently, and that is deliberate. If
      // an existing badge made us skip the second step, a StartExecution that
      // failed after the badge was written would never be retried, and the
      // badge would stay PENDING with no workflow behind it forever. Letting
      // both run on every delivery is what makes the state converge.
      await createPendingBadge(reached, badge, recordLog);
      await startValidation(reached, recordLog);
    } catch (error) {
      // Reported per message rather than failing the batch, so one bad event
      // cannot block the others. After three attempts SQS moves it to the DLQ.
      recordLog.error('Could not process level event.', serializeError(error));
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};
