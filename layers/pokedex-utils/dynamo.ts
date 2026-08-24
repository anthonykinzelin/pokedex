import {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type PutCommandInput,
  type QueryCommandInput,
  type TransactWriteCommandInput,
  type UpdateCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { documentClient } from './aws';

// What DynamoDB hands back before a caller decides what it is. Every read is
// generic over this, so a handler can name the shape it expects instead of
// indexing an untyped object.
export type Item = Record<string, unknown>;

export async function getItem<T = Item>(
  tableName: string,
  PK: string,
  SK: string,
): Promise<T | undefined> {
  const result = await documentClient.send(new GetCommand({
    TableName: tableName,
    Key: { PK, SK },
    ConsistentRead: true,
  }));

  return result.Item as T | undefined;
}

export type PutOptions = Omit<PutCommandInput, 'TableName' | 'Item'>;

export function putItem(tableName: string, item: Item, options: PutOptions = {}) {
  return documentClient.send(new PutCommand({
    TableName: tableName,
    Item: item,
    ...options,
  }));
}

export function putItemConditional(
  tableName: string,
  item: Item,
  conditionExpression?: string,
  expressionAttributeValues?: Record<string, unknown>,
) {
  const options: PutOptions = {};

  if (conditionExpression) {
    options.ConditionExpression = conditionExpression;
  }
  if (expressionAttributeValues && Object.keys(expressionAttributeValues).length > 0) {
    options.ExpressionAttributeValues = expressionAttributeValues;
  }

  return putItem(tableName, item, options);
}

export type UpdateOptions = Omit<UpdateCommandInput, 'TableName' | 'Key'>;

// The key is spelled out and the rest passed through, so a caller can still
// reach ReturnValues or ConditionExpression. Worth remembering when reading the
// callers: unlike TransactWriteItems, a plain UpdateItem *can* return the
// values it just wrote, through ReturnValues.
export function updateItem(
  tableName: string,
  PK: string,
  SK: string,
  options: UpdateOptions,
) {
  return documentClient.send(new UpdateCommand({
    TableName: tableName,
    Key: { PK, SK },
    ...options,
  }));
}

export type QueryOptions = Omit<
  QueryCommandInput,
  'TableName' | 'IndexName' | 'KeyConditionExpression' | 'ExclusiveStartKey'
>;

// DynamoDB pages every query at 1 MB, whether or not a Limit was asked for, so
// a single send() can return a partial answer with no error. Both public query
// helpers go through here rather than each carrying its own loop.
async function queryAllPages<T>(
  input: Omit<QueryCommandInput, 'ExclusiveStartKey'>,
): Promise<T[]> {
  const items: T[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const result = await documentClient.send(new QueryCommand({
      ...input,
      ExclusiveStartKey: exclusiveStartKey,
    }));

    items.push(...((result.Items || []) as T[]));
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return items;
}

export function queryAllByGSI<T = Item>(
  tableName: string,
  indexName: string,
  partitionKey: string,
  partitionValue: string | number,
  options: QueryOptions = {},
): Promise<T[]> {
  // Merged rather than spread over: a caller passing its own
  // ExpressionAttributeValues, as any FilterExpression must, would otherwise
  // wipe out :partitionValue and the query would fail.
  const { ExpressionAttributeValues, ...restOptions } = options;

  return queryAllPages<T>({
    TableName: tableName,
    IndexName: indexName,
    KeyConditionExpression: `${partitionKey} = :partitionValue`,
    ...restOptions,
    ExpressionAttributeValues: {
      ':partitionValue': partitionValue,
      ...ExpressionAttributeValues,
    },
  });
}

// A query on the table's own key, with an optional sort-key prefix. This is
// what makes one item collection - a user and everything hanging off them -
// readable in one call, and it is the reason a single-table design puts related
// items under the same PK in the first place.
export function queryAllByPK<T = Item>(
  tableName: string,
  partitionValue: string,
  skPrefix?: string,
  options: QueryOptions = {},
): Promise<T[]> {
  const { ExpressionAttributeValues, ...restOptions } = options;
  const values: Record<string, unknown> = { ':pk': partitionValue };
  let keyCondition = 'PK = :pk';

  if (skPrefix) {
    keyCondition += ' AND begins_with(SK, :skPrefix)';
    values[':skPrefix'] = skPrefix;
  }

  return queryAllPages<T>({
    TableName: tableName,
    KeyConditionExpression: keyCondition,
    ...restOptions,
    ExpressionAttributeValues: { ...values, ...ExpressionAttributeValues },
  });
}

type TransactItem = NonNullable<TransactWriteCommandInput['TransactItems']>[number];

// One operation - Put, Update, Delete or ConditionCheck - minus the TableName,
// which transactWrite supplies. Mapping over the SDK's own type is what makes
// a typo in UpdateExpression or a misspelled ExpressionAttributeNames fail at
// compile time instead of at runtime.
export type TransactOperation = {
  [K in keyof TransactItem]?: Omit<NonNullable<TransactItem[K]>, 'TableName'>;
};

// All operations are sent to one table. A cross-table transaction would need a
// TableName per operation. The DynamoDB error to know here is
// TransactionCanceledException: its CancellationReasons array lines up
// positionally with the operations passed in, which is how a caller can tell
// which condition failed.
export function transactWrite(tableName: string, operations: TransactOperation[]) {
  const TransactItems = operations.map((operation) => {
    const [operationName] = Object.keys(operation) as (keyof TransactOperation)[];

    return {
      [operationName]: {
        TableName: tableName,
        ...operation[operationName],
      },
    } as TransactItem;
  });

  return documentClient.send(new TransactWriteCommand({ TransactItems }));
}
