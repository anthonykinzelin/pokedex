import {
  SFNClient,
  SendTaskSuccessCommand,
  StartExecutionCommand,
} from '@aws-sdk/client-sfn';

// One client for the whole container, like documentClient and
// eventBridgeClient. Building it at module load means the TLS handshake happens
// during the cold start rather than inside the first request.
const sfnClient = new SFNClient({});

// A callback token is an opaque blob of several hundred characters - far past
// requireString's 200-character default, which is sized for names a person
// typed. Validating a token with that default rejects every real token and
// fails the whole workflow, so any check on a token must pass this explicitly.
export const MAX_TASK_TOKEN_LENGTH = 2048;

// Both helpers let their errors through rather than translating them, the same
// way transactWrite does, because the caller is the only one that can say
// whether a given failure is expected. The two error names worth knowing:
//
// - ExecutionAlreadyExists  the deterministic name did its job, this event has
//                           already been handled. Not a failure.
// - TaskTimedOut            the callback token is no longer waiting, because
//                           the task timed out or somebody already decided.

export async function startExecution(
  stateMachineArn: string,
  name: string,
  input: unknown,
): Promise<string | undefined> {
  const result = await sfnClient.send(new StartExecutionCommand({
    stateMachineArn,
    name,
    input: JSON.stringify(input),
  }));

  return result.executionArn;
}

// Resuming a paused execution. `output` becomes the result of the waiting Task,
// so it is what the Choice state downstream reads - which is why a refusal
// travels through here, with the decision in the payload, and not through
// SendTaskFailure.
export async function sendTaskSuccess(
  taskToken: string,
  output: unknown,
): Promise<void> {
  await sfnClient.send(new SendTaskSuccessCommand({
    taskToken,
    output: JSON.stringify(output),
  }));
}
