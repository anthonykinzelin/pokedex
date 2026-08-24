export interface CancellationReason {
  Code?: string;
  Message?: string;
}

export interface AwsError extends Error {
  CancellationReasons?: CancellationReason[];
}

// Under strict mode a caught error is `unknown`. Narrowed structurally rather
// than with `instanceof` against the SDK's exception classes: no handler imports
// the SDK, and `instanceof` silently returns false when two copies of a module
// end up in one process. Every field stays optional, which is exactly as much
// as a caller can rely on.
export function asAwsError(error: unknown): AwsError | undefined {
  return typeof error === 'object' && error !== null ? (error as AwsError) : undefined;
}

export function isErrorNamed(error: unknown, name: string): boolean {
  return asAwsError(error)?.name === name;
}

// The CancellationReasons of a cancelled transaction, or an empty array for any
// other error. Callers index into it by operation position.
export function cancellationReasons(error: unknown): CancellationReason[] {
  return asAwsError(error)?.CancellationReasons ?? [];
}
