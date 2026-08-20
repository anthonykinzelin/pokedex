const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDisplayName, toNameKey, toSlug } = require('pokedex-utils');

// assert.throws returns undefined, so capture the error when we want to
// inspect its fields.
function caught(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

test('normalizeDisplayName trims and collapses whitespace', () => {
  assert.equal(normalizeDisplayName('  Ash   Ketchum  ', 'name'), 'Ash Ketchum');
  // JS \s covers a non-breaking space, so it is folded too.
  assert.equal(normalizeDisplayName('Ash Ketchum', 'name'), 'Ash Ketchum');
});

test('normalizeDisplayName composes accents so one name is one string', () => {
  const decomposed = 'Pokémon';  // e + combining acute
  const composed = 'Pokémon';     // precomposed é
  assert.equal(normalizeDisplayName(decomposed, 'name'), composed);
});

test('normalizeDisplayName counts code points, not UTF-16 units', () => {
  // Two emoji are 4 UTF-16 units but 2 code points, so a min of 2 accepts them
  // only if the length is measured properly. They fail the charset rule, which
  // is the point: the length check must not be what rejects them.
  assert.throws(() => normalizeDisplayName('\u{1F600}\u{1F600}', 'name'), /may only contain/);
});

test('normalizeDisplayName enforces the length bounds', () => {
  assert.throws(() => normalizeDisplayName('A', 'name'), /between 2 and 60/);
  assert.throws(() => normalizeDisplayName('A'.repeat(61), 'name'), /between 2 and 60/);
  assert.equal(normalizeDisplayName('Ab', 'name'), 'Ab');
});

test('normalizeDisplayName rejects the key separator', () => {
  // '#' separates the parts of every PK and SK, so a name containing it could
  // otherwise be crafted to look like another item's key.
  assert.throws(() => normalizeDisplayName('x#RESERVATION', 'name'), /may only contain/);
});

test('normalizeDisplayName reports the field name it was given', () => {
  const error = caught(() => normalizeDisplayName('', 'trainerName'));
  assert.equal(error.field, 'trainerName');
  assert.equal(error.statusCode, 400);
});

test('toNameKey folds case, so Ash and ash are the same trainer', () => {
  assert.equal(toNameKey('Ash'), toNameKey('ash'));
  assert.equal(toNameKey('ASH KETCHUM'), 'ash ketchum');
});

test('toNameKey folds compatibility variants', () => {
  assert.equal(toNameKey('Ｒed'), toNameKey('Red'));  // full-width R
});

test('toSlug strips accents and punctuation', () => {
  assert.equal(toSlug('Pikachu'), 'pikachu');
  assert.equal(toSlug('Pokemon Bleu'), 'pokemon-bleu');
  assert.equal(toSlug('Pokémon Bleu'), 'pokemon-bleu');
  assert.equal(toSlug('Mr. Mime'), 'mr-mime');
});

test('toSlug returns empty when nothing survives, so the caller can reject it', () => {
  assert.equal(toSlug('---'), '');
});
