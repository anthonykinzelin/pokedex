import type { SQSBatchItemFailure, SQSHandler } from 'aws-lambda';
import {
  LEVEL_REACHED,
  POINTS_PER_PURCHASE,
  PURCHASE_COMPLETED,
  createLogger,
  getItem,
  isErrorNamed,
  levelFor,
  levelsCrossed,
  parseEvent,
  publishEvent,
  requireEnv,
  serializeError,
  transactWrite,
  updateItem,
  type EventDetail,
  type Logger,
} from 'pokedex-utils';

const TABLE_NAME = requireEnv('TABLE_NAME');
const EVENT_BUS_NAME = requireEnv('EVENT_BUS_NAME');

type PurchaseCompleted = EventDetail<typeof PURCHASE_COMPLETED>;

interface LevelItem {
  points?: number;
  publishedLevel?: number;
}

// Records the purchase and adds its points in one transaction. The processed
// marker carries the idempotency: a redelivered message lands on the same PK
// and SK, the condition fails, and the points are not added twice.
async function countPurchase(detail: PurchaseCompleted, log: Logger): Promise<void> {
  const { userId, purchaseId } = detail;
  const userKey = `USER#${userId}`;

  try {
    await transactWrite(TABLE_NAME, [
      {
        Put: {
          Item: {
            PK: userKey,
            SK: `PURCHASE#${purchaseId}`,
            entity: 'PROCESSED_PURCHASE',
            purchaseId,
            pokemonId: detail.pokemonId,
            occurredAt: detail.occurredAt,
            processedAt: new Date().toISOString(),
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      },
      {
        Update: {
          Key: { PK: userKey, SK: 'LEVEL' },
          UpdateExpression: [
            'SET userId = if_not_exists(userId, :userId), updatedAt = :updatedAt',
            'ADD points :points',
          ].join(' '),
          ExpressionAttributeValues: {
            ':userId': userId,
            ':updatedAt': new Date().toISOString(),
            ':points': POINTS_PER_PURCHASE,
          },
        },
      },
    ]);
  } catch (error) {
    if (!isErrorNamed(error, 'TransactionCanceledException')) {
      throw error;
    }

    const processedPurchase = await getItem(
      TABLE_NAME,
      userKey,
      `PURCHASE#${purchaseId}`,
    );

    if (!processedPurchase) {
      throw error;
    }

    log.info('Purchase was already counted.', { purchaseId });
  }
}

// Announces every level the new total has crossed. publishedLevel is a
// watermark: the highest level already on the bus. It is advanced only after
// the events are out, so a crash here republishes on the next purchase
// (at-least-once) instead of losing a badge to a transient PutEvents failure.
async function publishReachedLevels(userId: string, log: Logger): Promise<void> {
  const userKey = `USER#${userId}`;
  const item = await getItem<LevelItem>(TABLE_NAME, userKey, 'LEVEL');
  const points = item?.points ?? 0;
  const reached = levelFor(points);
  const levels = levelsCrossed(item?.publishedLevel, reached);

  if (levels.length === 0) {
    return;
  }

  for (const level of levels) {
    await publishEvent(EVENT_BUS_NAME, LEVEL_REACHED, {
      eventVersion: '1.0',
      userId,
      level,
      points,
      reachedAt: new Date().toISOString(),
    });

    log.info('Published a reached level.', { level, points });
  }

  try {
    await updateItem(TABLE_NAME, userKey, 'LEVEL', {
      UpdateExpression: 'SET publishedLevel = :reached',
      ConditionExpression:
        'attribute_not_exists(publishedLevel) OR publishedLevel < :reached',
      ExpressionAttributeValues: { ':reached': reached },
    });
  } catch (error) {
    if (!isErrorNamed(error, 'ConditionalCheckFailedException')) {
      throw error;
    }

    log.info('The watermark had already moved past this level.', { reached });
  }
}

// Failures are reported per message rather than by failing the batch, so one
// bad event cannot block the others. Publishing runs even when the purchase was
// already counted: that is what repairs a level whose event never went out.
export const handler: SQSHandler = async (event, context) => {
  const log = createLogger({
    route: 'levels-consumer',
    requestId: context?.awsRequestId,
  });
  const batchItemFailures: SQSBatchItemFailure[] = [];

  for (const record of event.Records || []) {
    const recordLog = log.child({ messageId: record.messageId });

    try {
      const detail = parseEvent(PURCHASE_COMPLETED, record.body);

      await countPurchase(detail, recordLog);
      await publishReachedLevels(detail.userId, recordLog);
    } catch (error) {
      recordLog.error('Could not process purchase event.', serializeError(error));
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};
