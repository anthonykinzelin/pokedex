const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

const endpoint = process.env.DYNAMODB_ENDPOINT;
const clientOptions = endpoint
  ? {
      endpoint,
      region: process.env.AWS_REGION || 'eu-west-1',
      credentials: {
        accessKeyId: 'local',
        secretAccessKey: 'local',
      },
    }
  : {};

const baseDynamoClient = new DynamoDBClient(clientOptions);

const documentClient = DynamoDBDocumentClient.from(baseDynamoClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

module.exports = {
  documentClient,
};
