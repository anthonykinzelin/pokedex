import type { SQSBatchItemFailure, SQSHandler } from 'aws-lambda';
import {
  LEVEL_REACHED,
  badgeForLevel,
  badgeIdFor,
  badgeSortKey,
  createLogger,
  executionNameFor,
  isErrorNamed,
  parseEvent,
  putItemConditional,
  requireEnv,
  serializeError,
  startExecution,
  type BadgeDefinition,
  type EventDetail,
  type Logger,
} from 'pokedex-utils';

const TABLE_NAME = requireEnv('TABLE_NAME');
const STATE_MACHINE_ARN = requireEnv('STATE_MACHINE_ARN');

type LevelReached = EventDetail<typeof LEVEL_REACHED>;

// Creates the badge in PENDING. One badge per user and per level, enforced by
// the key rather than by a read-then-write, so a redelivered event fails the
// condition instead of producing a second badge.
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

// Starts the validation workflow under a deterministic name: Step Functions
// refuses two executions with the same name, which rules out a duplicate
// workflow without a lock or a dedupe table.
async function startValidation(event: LevelReached, log: Logger): Promise<void> {
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

// A level the catalog ignores is a normal outcome, not a failure. Both steps run
// on every delivery, and are tolerated independently, so a StartExecution that
// failed after the badge was written is retried instead of leaving the badge
// PENDING with no workflow behind it.
export const handler: SQSHandler = async (event, context) => {
  const log = createLogger({
    route: 'badges-consumer',
    requestId: context?.awsRequestId,
  });
  const batchItemFailures: SQSBatchItemFailure[] = [];

  for (const record of event.Records || []) {
    const recordLog = log.child({ messageId: record.messageId });

    try {
      const reached = parseEvent(LEVEL_REACHED, record.body);
      const badge = badgeForLevel(reached.level);

      if (!badge) {
        recordLog.info('No badge is defined for this level.', { level: reached.level });
        continue;
      }

      await createPendingBadge(reached, badge, recordLog);
      await startValidation(reached, recordLog);
    } catch (error) {
      recordLog.error('Could not process level event.', serializeError(error));
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};
