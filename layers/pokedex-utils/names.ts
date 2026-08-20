import { ValidationError, requireString, type StringOptions } from './validate';

// A letter or digit of any script, then letters, digits, spaces and - _ . '
// '#' is excluded on purpose: it separates the parts of every PK and SK, so a
// name can never be crafted to collide with another item's key.
const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} '._-]*$/u;

// The name people see. NFC composes accents, so "e" followed by a combining
// acute stops being a different string from "é"; collapsing whitespace makes
// "Ash  Ketchum" the same as "Ash Ketchum".
export function normalizeDisplayName(
  value: unknown,
  field: string,
  { min = 2, max = 60 }: StringOptions = {},
): string {
  const trimmed = requireString(value, field);
  const displayName = trimmed.normalize('NFC').replace(/\s+/g, ' ');
  // Code points, not UTF-16 units: String.length counts a surrogate pair twice.
  const length = Array.from(displayName).length;

  if (length < min || length > max) {
    throw new ValidationError(
      `${field} must contain between ${min} and ${max} characters.`,
      field,
    );
  }
  if (!NAME_PATTERN.test(displayName)) {
    throw new ValidationError(
      `${field} may only contain letters, digits, spaces and the characters - _ . '`,
      field,
    );
  }

  return displayName;
}

// The value used to answer "is this the same name?". NFKC folds compatibility
// variants (full-width Ａ, the ﬁ ligature) and toLowerCase folds case, so
// "Ash", "ash" and "Ａsh" are one trainer. Not toLocaleLowerCase: that depends
// on the host locale, which would make the key differ between machines.
export function toNameKey(displayName: string): string {
  return displayName.normalize('NFKC').toLowerCase();
}

// A url-safe identity derived from the name. Used where the name IS the
// identity, so that a single conditional write gives uniqueness for free.
export function toSlug(displayName: string): string {
  return displayName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')  // drop the combining accents NFKD split off
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
