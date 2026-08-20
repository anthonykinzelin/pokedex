import { HttpError } from './http';

// A 400 that also names the offending field. Extending HttpError means
// errorResponse already knows how to render it, and the field name reaches the
// response body through HttpError's details.
export class ValidationError extends HttpError {
  field: string;

  constructor(message: string, field: string) {
    super(400, message, { field });
    this.name = 'ValidationError';
    this.field = field;
  }
}

export interface StringOptions {
  min?: number;
  max?: number;
}

export function requireString(
  value: unknown,
  field: string,
  { min = 1, max = 200 }: StringOptions = {},
): string {
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} must be a string.`, field);
  }

  const trimmed = value.trim();
  // Code points, not UTF-16 units: String.length counts a surrogate pair twice.
  const length = Array.from(trimmed).length;

  if (length < min) {
    throw new ValidationError(
      min === 1
        ? `${field} must not be empty.`
        : `${field} must contain at least ${min} characters.`,
      field,
    );
  }
  if (length > max) {
    throw new ValidationError(`${field} must contain at most ${max} characters.`, field);
  }

  return trimmed;
}

export interface IntegerOptions {
  min?: number;
  max?: number;
}

// Money is an integer number of pokecoins, so balance - price in the purchase
// transaction can never accumulate floating point dust.
export function requireInteger(
  value: unknown,
  field: string,
  { min = 0, max = Number.MAX_SAFE_INTEGER }: IntegerOptions = {},
): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ValidationError(`${field} must be an integer.`, field);
  }
  if (value < min || value > max) {
    throw new ValidationError(`${field} must be between ${min} and ${max}.`, field);
  }

  return value;
}

// Every listed field must be a non-empty string. Returns the trimmed values,
// keyed by the field names that were asked for, so the caller gets
// `{ userId: string, purchaseId: string }` rather than an untyped record.
export function requireStrings<K extends string>(
  object: unknown,
  fields: readonly K[],
): Record<K, string> {
  const source = object as Record<string, unknown> | null | undefined;
  const result = {} as Record<K, string>;

  for (const field of fields) {
    result[field] = requireString(source?.[field], field);
  }

  return result;
}

// Rejecting unknown fields is what makes a stale client fail loudly. Without
// it, a caller still sending the old userId would be silently ignored.
export function rejectUnknownFields(
  object: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const unknown = Object.keys(object).filter((key) => !allowed.includes(key));

  if (unknown.length > 0) {
    throw new ValidationError(
      `Unknown field(s): ${unknown.join(', ')}. Allowed field(s): ${allowed.join(', ')}.`,
      unknown[0]!,
    );
  }
}

// process.env values are string | undefined, so every table name would need a
// check at each call site. Reading them through here instead turns a missing
// variable into one loud failure at module load, rather than an undefined
// table name reaching DynamoDB and coming back as a confusing validation
// error on the first request.
export function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not configured.`);
  }

  return value;
}
