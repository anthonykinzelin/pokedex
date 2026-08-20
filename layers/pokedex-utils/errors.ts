// Under strict mode a caught error is `unknown`, so the two things this code
// reads off an AWS SDK error - its name and, for a cancelled transaction, its
// cancellation reasons - have to be narrowed before they can be touched.
//
// Narrowed structurally rather than with `instanceof` against the SDK's
// exception classes: no handler imports the SDK (it lives in the layer), and
// `instanceof` silently returns false when two copies of a module end up in
// one process. Comparing the name is what the JavaScript did and it keeps
// working no matter where the error came from.

export interface CancellationReason {
  Code?: string;
  Message?: string;
}

export interface AwsError extends Error {
  // Present on TransactionCanceledException, positionally aligned with the
  // operations that were passed to transactWrite.
  CancellationReasons?: CancellationReason[];
}

// Anything can be thrown, so this only claims the value is an object. The
// fields are all optional, which is exactly as much as a caller can rely on.
export function asAwsError(error: unknown): AwsError | undefined {
  return typeof error === 'object' && error !== null ? (error as AwsError) : undefined;
}

export function isErrorNamed(error: unknown, name: string): boolean {
  return asAwsError(error)?.name === name;
}

// The CancellationReasons of a cancelled transaction, or an empty array for
// any other error. Callers index into it by operation position.
export function cancellationReasons(error: unknown): CancellationReason[] {
  return asAwsError(error)?.CancellationReasons ?? [];
}
