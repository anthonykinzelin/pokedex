const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { EventBridgeClient } = require('@aws-sdk/client-eventbridge');

const baseDynamoClient = new DynamoDBClient({});

const documentClient = DynamoDBDocumentClient.from(baseDynamoClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

const eventBridgeClient = new EventBridgeClient({});

module.exports = {
  documentClient,
  eventBridgeClient,
};