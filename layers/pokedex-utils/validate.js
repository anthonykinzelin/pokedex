const { HttpError } = require('./http');

// A 400 that also names the offending field. Extending HttpError means
// errorResponse already knows how to render it, and the field name reaches the
// response body through HttpError's details.
class ValidationError extends HttpError {
  constructor(message, field) {
    super(400, message, { field });
    this.name = 'ValidationError';
    this.field = field;
  }
}

function requireString(value, field, { min = 1, max = 200 } = {}) {
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

// Money is an integer number of pokecoins, so balance - price in the purchase
// transaction can never accumulate floating point dust.
function requireInteger(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ValidationError(`${field} must be an integer.`, field);
  }
  if (value < min || value > max) {
    throw new ValidationError(`${field} must be between ${min} and ${max}.`, field);
  }

  return value;
}

// Every listed field must be a non-empty string. Returns the trimmed values.
function requireStrings(object, fields) {
  const result = {};

  for (const field of fields) {
    result[field] = requireString(object?.[field], field);
  }

  return result;
}

// Rejecting unknown fields is what makes a stale client fail loudly. Without
// it, a caller still sending the old userId would be silently ignored.
function rejectUnknownFields(object, allowed) {
  const unknown = Object.keys(object).filter((key) => !allowed.includes(key));

  if (unknown.length > 0) {
    throw new ValidationError(
      `Unknown field(s): ${unknown.join(', ')}. Allowed field(s): ${allowed.join(', ')}.`,
      unknown[0],
    );
  }
}

module.exports = {
  ValidationError,
  rejectUnknownFields,
  requireInteger,
  requireString,
  requireStrings,
};
