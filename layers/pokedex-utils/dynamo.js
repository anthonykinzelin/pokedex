const {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
} = require('@aws-sdk/lib-dynamodb');
const { documentClient } = require('./aws');

async function getItem(tableName, PK, SK) {
  const result = await documentClient.send(new GetCommand({
    TableName: tableName,
    Key: { PK, SK },
    ConsistentRead: true,
  }));

  return result.Item;
}

function putItem(tableName, item, options = {}) {
  return documentClient.send(new PutCommand({
    TableName: tableName,
    Item: item,
    ...options,
  }));
}

function putItemConditional(tableName, item, conditionExpression, expressionAttributeValues) {
  const options = {};

  if (conditionExpression) {
    options.ConditionExpression = conditionExpression;
  }
  if (expressionAttributeValues && Object.keys(expressionAttributeValues).length > 0) {
    options.ExpressionAttributeValues = expressionAttributeValues;
  }

  return putItem(tableName, item, options);
}

async function queryAllByGSI(tableName, indexName, partitionKey, partitionValue, options = {}) {
  const items = [];
  let exclusiveStartKey;
  // Merged rather than spread over: a caller passing its own
  // ExpressionAttributeValues, as any FilterExpression must, would otherwise
  // wipe out :partitionValue and the query would fail.
  const { ExpressionAttributeValues, ...restOptions } = options;

  do {
    const result = await documentClient.send(new QueryCommand({
      TableName: tableName,
      IndexName: indexName,
      KeyConditionExpression: `${partitionKey} = :partitionValue`,
      ...restOptions,
      ExpressionAttributeValues: {
        ':partitionValue': partitionValue,
        ...ExpressionAttributeValues,
      },
      ExclusiveStartKey: exclusiveStartKey,
    }));

    items.push(...(result.Items || []));
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return items;
}

// All operations are sent to one table. A cross-table transaction would need a
// TableName per operation. The DynamoDB error to know here is
// TransactionCanceledException: its CancellationReasons array lines up
// positionally with the operations passed in, which is how a caller can tell
// which condition failed.
function transactWrite(tableName, operations) {
  const TransactItems = operations.map((operation) => {
    const [operationName] = Object.keys(operation);
    return {
      [operationName]: {
        TableName: tableName,
        ...operation[operationName],
      },
    };
  });

  return documentClient.send(new TransactWriteCommand({ TransactItems }));
}

module.exports = {
  getItem,
  putItem,
  putItemConditional,
  queryAllByGSI,
  transactWrite,
};
