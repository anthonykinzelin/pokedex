import {
  SFNClient,
  SendTaskSuccessCommand,
  StartExecutionCommand,
} from '@aws-sdk/client-sfn';

const sfnClient = new SFNClient({});

export const MAX_TASK_TOKEN_LENGTH = 2048;

// Errors are let through rather than translated: only the caller can say whether
// a failure is expected. ExecutionAlreadyExists means the deterministic name did
// its job and this event was already handled.
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

// Resumes a paused execution. `output` becomes the result of the waiting Task,
// so it is what the Choice state downstream reads - which is why a refusal
// travels through here, with the decision in the payload, and not through
// SendTaskFailure. TaskTimedOut means the token is no longer waiting.
export async function sendTaskSuccess(
  taskToken: string,
  output: unknown,
): Promise<void> {
  await sfnClient.send(new SendTaskSuccessCommand({
    taskToken,
    output: JSON.stringify(output),
  }));
}
