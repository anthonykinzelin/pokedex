const { getItem, transactWrite } = require('../../utils/dynamo');

const TABLE_NAME = process.env.TABLE_NAME;
const POINTS_PER_PURCHASE = 100;

function purchaseDetail(record) {
  const event = JSON.parse(record.body);
  const detail = event.detail;

  if (event.source !== 'fr.pokemon.referential'
    || event['detail-type'] !== 'purchase.completed'
    || detail?.eventVersion !== '1.0') {
    throw new Error('Unsupported purchase event.');
  }

  for (const field of ['purchaseId', 'userId', 'pokemonId', 'occurredAt']) {
    if (typeof detail[field] !== 'string' || !detail[field].trim()) {
      throw new Error(`The event detail is missing ${field}.`);
    }
  }

  return detail;
}

async function updateLevel(detail) {
  const userId = detail.userId.trim();
  const purchaseId = detail.purchaseId.trim();
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
            pokemonId: detail.pokemonId.trim(),
            occurredAt: detail.occurredAt,
            processedAt: new Date().toISOString(),
          },
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
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
    if (error?.name !== 'TransactionCanceledException') {
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

    console.log(`Purchase ${purchaseId} was already processed.`);
  }
}

exports.handler = async (event) => {
  const batchItemFailures = [];

  for (const record of event.Records || []) {
    try {
      await updateLevel(purchaseDetail(record));
    } catch (error) {
      console.error('Could not process purchase event.', {
        messageId: record.messageId,
        error: error.message,
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};
