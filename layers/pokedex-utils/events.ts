import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import type { EventDefinition } from './schemas';

const eventBridgeClient = new EventBridgeClient({});

// The detail is parsed against the event definition before it goes out, so a
// payload that no consumer could accept never reaches the bus.
export async function publishEvent<D>(
  eventBusName: string | undefined,
  event: EventDefinition<D>,
  detail: D,
): Promise<void> {
  if (!eventBusName) {
    throw new Error('EVENT_BUS_NAME is not configured.');
  }

  const result = await eventBridgeClient.send(new PutEventsCommand({
    Entries: [
      {
        EventBusName: eventBusName,
        Source: event.source,
        DetailType: event.detailType,
        Detail: JSON.stringify(event.detail.parse(detail)),
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

// Envelope first, then payload. An event from another source, or carrying an
// eventVersion this code was never written against, fails the same way on every
// attempt, so it belongs in the DLQ rather than in three retries first.
export function parseEvent<D>(
  event: EventDefinition<D>,
  body: string,
): D {
  return event.envelope.parse(JSON.parse(body)).detail;
}
