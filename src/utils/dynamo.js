const { documentClient } = require('./aws');

async function getItem(tableName, PK, SK) {
  const params = {
    TableName: tableName,
    Key: { PK, SK },
    ConsistentRead: true
  };
  const res = await documentClient.get(params);
  return res.Item;
}

async function putItemConditional(tableName, item, conditionExpression, expressionAttributeValues) {
  const params = {
    TableName: tableName,
    Item: item
  };
  if (conditionExpression) {
    params.ConditionExpression = conditionExpression;
    params.ExpressionAttributeValues = expressionAttributeValues;
  }
  return documentClient.put(params);
}

async function queryByPK(tableName, PK, options = {}) {
  const params = {
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': PK },
    ...options
  };
  return documentClient.query(params);
}

async function queryByGSI(tableName, indexName, keyName, keyValue, options = {}) {
  const params = {
    TableName: tableName,
    IndexName: indexName,
    KeyConditionExpression: `${keyName} = :v`,
    ExpressionAttributeValues: { ':v': keyValue },
    ...options
  };
  return documentClient.query(params);
}

async function transactWrite(TransactItems) {
  const params = { TransactItems };
  return documentClient.transactWrite(params);
}

module.exports = {
  getItem,
  putItemConditional,
  queryByPK,
  queryByGSI,
  transactWrite
};