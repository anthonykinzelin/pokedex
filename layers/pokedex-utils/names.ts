import { ValidationError, requireString, type StringOptions } from './validate';

const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} '._-]*$/u;

// The name people see. NFC composes accents, so "e" plus a combining acute stops
// being a different string from "é", and collapsing whitespace makes
// "Ash  Ketchum" the same as "Ash Ketchum". The pattern excludes '#' because it
// separates the parts of every PK and SK: a name can never be crafted to collide
// with another item's key. Length is counted in code points, not UTF-16 units.
export function normalizeDisplayName(
  value: unknown,
  field: string,
  { min = 2, max = 60 }: StringOptions = {},
): string {
  const trimmed = requireString(value, field);
  const displayName = trimmed.normalize('NFC').replace(/\s+/g, ' ');
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
// variants (full-width Ａ, the ﬁ ligature) and toLowerCase folds case, so "Ash",
// "ash" and "Ａsh" are one trainer. Not toLocaleLowerCase: that depends on the
// host locale, which would make the key differ between machines.
export function toNameKey(displayName: string): string {
  return displayName.normalize('NFKC').toLowerCase();
}

// A url-safe identity derived from the name, used where the name IS the identity
// so a single conditional write gives uniqueness for free. NFKD splits the
// accents off and the first replace drops them.
export function toSlug(displayName: string): string {
  return displayName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
