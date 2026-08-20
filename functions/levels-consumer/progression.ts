import type { SQSBatchItemFailure, SQSHandler, SQSRecord } from 'aws-lambda';
import {
  createLogger,
  getItem,
  isErrorNamed,
  requireEnv,
  requireStrings,
  serializeError,
  transactWrite,
  type Logger,
} from 'pokedex-utils';

const TABLE_NAME = requireEnv('TABLE_NAME');
const POINTS_PER_PURCHASE = 100;

// The fields requireStrings guarantees. The rest of the detail is carried
// through untouched, which is why the intersection keeps the index signature.
type PurchaseDetail = Record<string, unknown> & {
  purchaseId: string;
  userId: string;
  pokemonId: string;
  occurredAt: string;
};

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
  // returned values are trimmed, so updateLevel does not have to re-trim.
  return {
    ...detail,
    ...requireStrings(detail, ['purchaseId', 'userId', 'pokemonId', 'occurredAt']),
  };
}

async function updateLevel(detail: PurchaseDetail, log: Logger): Promise<void> {
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
            'ADD points :points, #level :levelIncrease',
          ].join(' '),
          ExpressionAttributeNames: { '#level': 'level' },
          ExpressionAttributeValues: {
            ':userId': userId,
            ':updatedAt': new Date().toISOString(),
            ':points': POINTS_PER_PURCHASE,
            ':levelIncrease': 1,
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

    log.info('Purchase was already processed.', { purchaseId });
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
      await updateLevel(purchaseDetail(record), recordLog);
    } catch (error) {
      // Reported per message rather than failing the batch, so one bad event
      // cannot block the others. After three attempts SQS moves it to the DLQ.
      recordLog.error('Could not process purchase event.', serializeError(error));
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};
