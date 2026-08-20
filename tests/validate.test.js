const test = require('node:test');
const assert = require('node:assert/strict');
const {
  rejectUnknownFields,
  requireInteger,
  requireString,
  requireStrings,
} = require('pokedex-utils');

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

test('requireString returns the trimmed value', () => {
  assert.equal(requireString('  a  ', 'f'), 'a');
});

test('requireString rejects non-strings and blanks', () => {
  assert.throws(() => requireString(undefined, 'f'), /f must be a string/);
  assert.throws(() => requireString(42, 'f'), /f must be a string/);
  assert.throws(() => requireString('   ', 'f'), /f must not be empty/);
});

test('requireInteger keeps money as whole pokecoins', () => {
  assert.equal(requireInteger(25, 'price'), 25);
  assert.throws(() => requireInteger(25.5, 'price'), /must be an integer/);
  assert.throws(() => requireInteger('25', 'price'), /must be an integer/);
  assert.throws(() => requireInteger(-1, 'price', { min: 0 }), /between 0 and/);
});

test('rejectUnknownFields makes a stale client fail loudly', () => {
  // The whole point of the refactor: a caller still sending the old
  // server-assigned id must get a clear 400, not silent acceptance.
  const error = caught(
    () => rejectUnknownFields({ userId: 'u1', name: 'Ash' }, ['name', 'balance']),
  );
  assert.equal(error.statusCode, 400);
  assert.equal(error.field, 'userId');
  assert.match(error.message, /userId/);
});

test('rejectUnknownFields passes a valid body through', () => {
  assert.doesNotThrow(() => rejectUnknownFields({ name: 'Ash', balance: 10 }, ['name', 'balance']));
});

test('requireStrings returns every field trimmed', () => {
  assert.deepEqual(
    requireStrings({ a: ' 1 ', b: '2' }, ['a', 'b']),
    { a: '1', b: '2' },
  );
  assert.throws(() => requireStrings({ a: '1' }, ['a', 'b']), /b must be a string/);
});
