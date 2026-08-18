const {
  EventBridgeClient,
  PutEventsCommand,
} = require('@aws-sdk/client-eventbridge');

const eventBridgeClient = new EventBridgeClient({});

async function publishEvent(eventBusName, source, detailType, detail) {
  if (!eventBusName) {
    throw new Error('EVENT_BUS_NAME is not configured.');
  }

  const result = await eventBridgeClient.send(new PutEventsCommand({
    Entries: [
      {
        EventBusName: eventBusName,
        Source: source,
        DetailType: detailType,
        Detail: JSON.stringify(detail),
      },
    ],
  }));

  if (result.FailedEntryCount) {
    const failure = result.Entries?.[0];
    const errorCode = failure?.ErrorCode || 'unknown error';
    const errorMessage = failure?.ErrorMessage ? ` - ${failure.ErrorMessage}` : '';
    throw new Error(`EventBridge rejected the event: ${errorCode}${errorMessage}`);
  }
}

module.exports = { publishEvent };
