import type { SQSBatchItemFailure, SQSHandler, SQSRecord } from 'aws-lambda';
import {
  POINTS_PER_PURCHASE,
  createLogger,
  getItem,
  isErrorNamed,
  levelFor,
  levelsCrossed,
  publishEvent,
  requireEnv,
  requireStrings,
  serializeError,
  transactWrite,
  updateItem,
  type Logger,
} from 'pokedex-utils';

const TABLE_NAME = requireEnv('TABLE_NAME');
// Read at module load, not left to publishEvent's own guard: a missing bus name
// is a broken deploy, and it should fail on the first invocation rather than
// once per message, forever, through the DLQ.
const EVENT_BUS_NAME = requireEnv('EVENT_BUS_NAME');

// The fields requireStrings guarantees. The rest of the detail is carried
// through untouched, which is why the intersection keeps the index signature.
type PurchaseDetail = Record<string, unknown> & {
  purchaseId: string;
  userId: string;
  pokemonId: string;
  occurredAt: string;
};

// Only the attributes this function reads back. `level` is deliberately absent:
// it is derived from `points` by levelFor, never stored, so there is one source
// of truth for a user's level instead of two that can drift apart.
interface LevelItem {
  points?: number;
  publishedLevel?: number;
}

function purchaseDetail(record: SQSRecord): PurchaseDetail {
  const event = JSON.parse(record.body);
  const detail = event.detail;

  if (event.source !== 'fr.pokemon.referential'
    || event['detail-type'] !== 'purchase.completed'
    || detail?.eventVersion !== '1.0') {
    throw new Error('Unsupported purchase event.');
  }

  // Same helper as the HTTP handlers. The 400 it carries is meaningless off
  // the HTTP path: here the throw just sends the message to the DLQ. The
  // returned values are trimmed, so countPurchase does not have to re-trim.
  return {
    ...detail,
    ...requireStrings(detail, ['purchaseId', 'userId', 'pokemonId', 'occurredAt']),
  };
}

async function countPurchase(detail: PurchaseDetail, log: Logger): Promise<void> {
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
          // A Put supplies the whole primary key, so PK alone already means
          // "no marker at this exact PK and SK". This is what makes a
          // redelivered SQS message stop before it adds the points twice.
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

// The answer to "how does Levels know the level changed?". TransactWriteItems
// returns nothing at all, so the new total has to be read back - and getItem
// asks for a ConsistentRead, so it sees the write that just committed rather
// than a possibly stale replica.
async function publishReachedLevels(userId: string, log: Logger): Promise<void> {
  const userKey = `USER#${userId}`;
  const item = await getItem<LevelItem>(TABLE_NAME, userKey, 'LEVEL');
  const points = item?.points ?? 0;
  const reached = levelFor(points);
  // publishedLevel is a watermark: the highest level already announced on the
  // bus. Comparing it to the level the points now buy is what turns "add some
  // points" into "these specific levels were reached".
  const levels = levelsCrossed(item?.publishedLevel, reached);

  if (levels.length === 0) {
    return;
  }

  for (const level of levels) {
    // A fact, not an order: "this user is at level 2". Naming the badge here
    // would make Levels own the badge policy, and the boundary with the Badges
    // service would stop meaning anything.
    //
    // `points` is the total as of now rather than the total at the moment this
    // level was crossed. For a level being caught up after a failed publish
    // the two differ, and the level is the part consumers key off.
    await publishEvent(EVENT_BUS_NAME, 'fr.pokemon.levels', 'level.reached', {
      eventVersion: '1.0',
      userId,
      level,
      points,
      reachedAt: new Date().toISOString(),
    });

    log.info('Published a reached level.', { level, points });
  }

  // Only after the events are out. The order is the whole design: publishing
  // first and advancing second means a crash here republishes on the next
  // purchase, which is at-least-once. Advancing first would be at-most-once,
  // and a badge lost to a transient PutEvents failure would never come back.
  try {
    await updateItem(TABLE_NAME, userKey, 'LEVEL', {
      UpdateExpression: 'SET publishedLevel = :reached',
      ConditionExpression:
        'attribute_not_exists(publishedLevel) OR publishedLevel < :reached',
      ExpressionAttributeValues: { ':reached': reached },
    });
  } catch (error) {
    // Another invocation got further than this one while we were publishing.
    // Its watermark is higher, so overwriting it would re-announce levels that
    // were already announced. Leaving it alone is the correct outcome.
    if (!isErrorNamed(error, 'ConditionalCheckFailedException')) {
      throw error;
    }

    log.info('The watermark had already moved past this level.', { reached });
  }
}

export const handler: SQSHandler = async (event, context) => {
  const log = createLogger({
    route: 'levels-consumer',
    requestId: context?.awsRequestId,
  });
  const batchItemFailures: SQSBatchItemFailure[] = [];

  for (const record of event.Records || []) {
    const recordLog = log.child({ messageId: record.messageId });

    try {
      const detail = purchaseDetail(record);

      await countPurchase(detail, recordLog);
      // Deliberately outside countPurchase, and reached even when the purchase
      // was already counted. That is what repairs a level whose event failed to
      // publish on an earlier delivery: the points are in, the watermark is
      // not, so the retry emits the event that went missing.
      //
      // Unlike purchase.ts - which swallows a publish failure so a Levels
      // outage cannot fail a committed purchase - a failure here must surface.
      // SQS will redeliver, counting is idempotent, and the retry fixes it.
      await publishReachedLevels(detail.userId, recordLog);
    } catch (error) {
      // Reported per message rather than failing the batch, so one bad event
      // cannot block the others. After three attempts SQS moves it to the DLQ.
      recordLog.error('Could not process purchase event.', serializeError(error));
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};
