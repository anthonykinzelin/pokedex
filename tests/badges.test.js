const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BADGE_CATALOG,
  BADGE_SK_PREFIX,
  MAX_TASK_TOKEN_LENGTH,
  badgeForLevel,
  badgeIdFor,
  badgeSortKey,
  executionNameFor,
  levelFromBadgeId,
  requireString,
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

test('the catalog leaves a gap, so the "no badge" path is reachable', () => {
  assert.ok(badgeForLevel(1));
  assert.ok(badgeForLevel(2));
  // Level 3 earns nothing. The consumer has to acknowledge that message and
  // create nothing, rather than fail and eventually fill the DLQ.
  assert.equal(badgeForLevel(3), undefined);
  assert.ok(badgeForLevel(4));
  assert.equal(badgeForLevel(99), undefined);
});

test('every catalog entry has a code and a label', () => {
  for (const [level, badge] of Object.entries(BADGE_CATALOG)) {
    assert.match(level, /^\d+$/);
    assert.match(badge.code, /^[a-z-]+$/, `level ${level}`);
    assert.ok(badge.label.length > 0, `level ${level}`);
  }
});

test('a badgeId is URL safe and a sort key is not', () => {
  // The badgeId travels in the request path. A `#` there would be read as the
  // start of a fragment and never reach API Gateway.
  assert.equal(badgeIdFor(2), 'lvl-2');
  assert.ok(!badgeIdFor(2).includes('#'));
  assert.equal(badgeSortKey(2), 'BADGE#LEVEL#2');
  assert.ok(badgeSortKey(2).startsWith(BADGE_SK_PREFIX));
});

test('levelFromBadgeId is the exact inverse of badgeIdFor', () => {
  for (const level of [1, 2, 4, 37]) {
    assert.equal(levelFromBadgeId(badgeIdFor(level)), level);
  }
  assert.equal(levelFromBadgeId('  lvl-2  '), 2);
});

test('levelFromBadgeId rejects anything else as a 400', () => {
  for (const bad of ['lvl-', 'lvl-x', 'LVL-2', 'lvl-2x', '2', '', undefined, null, 42]) {
    const error = caught(() => levelFromBadgeId(bad));
    assert.equal(error.name, 'ValidationError', `input ${JSON.stringify(bad)}`);
    assert.equal(error.statusCode, 400);
    assert.equal(error.field, 'badgeId');
  }
});

test('an execution name is deterministic, which is what buys the idempotency', () => {
  const userId = '3eacd9de-0000-4000-8000-000000000001';
  assert.equal(executionNameFor(userId, 2), executionNameFor(userId, 2));
  assert.equal(executionNameFor(userId, 2), `badge-${userId}-lvl-2`);
});

test('an execution name stays inside the 80 character limit', () => {
  const long = 'u'.repeat(300);
  const name = executionNameFor(long, 4);
  assert.ok(name.length <= 80, `got ${name.length}`);
  assert.equal(name, executionNameFor(long, 4));
});

test('an execution name never collapses two users onto one name', () => {
  // This is the failure that would matter: two ids mapping to one name means
  // Step Functions rejects the second user's execution as a duplicate, and
  // that badge sits PENDING with no workflow behind it forever. Truncating or
  // replacing unsafe characters would do exactly that, so both cases hash.
  assert.notEqual(
    executionNameFor(`${'u'.repeat(80)}a`, 1),
    executionNameFor(`${'u'.repeat(80)}b`, 1),
  );
  assert.notEqual(executionNameFor('user#1', 1), executionNameFor('user$1', 1));
});

test('an execution name only uses characters Step Functions accepts', () => {
  const forbidden = /[\s<>{}[\]?*"#%\\^|~`$&,;:/]/;
  for (const userId of ['plain-id', 'user#1', 'a b:c/d', 'u'.repeat(300)]) {
    assert.ok(
      !forbidden.test(executionNameFor(userId, 1)),
      `${userId} produced ${executionNameFor(userId, 1)}`,
    );
  }
});

test('the level is part of the execution name, so each badge gets its own run', () => {
  const userId = 'abc';
  assert.notEqual(executionNameFor(userId, 1), executionNameFor(userId, 2));
});

test('a real callback token survives validation', () => {
  // Regression. A Step Functions task token is roughly 900 characters, and
  // requireString defaults to a 200-character ceiling because it was written
  // for names a person typed. Passing a token through that default rejected
  // every token, failed the RegisterDecision task, and left the badge PENDING
  // with a failed execution behind it.
  const realisticToken = `AQCIAAAAKgAAAAMAAAAAAAAAA${'b3C4tVtUK0oY2byDhsysojYxTwmzY'.repeat(30)}`;
  assert.ok(realisticToken.length > 200, 'the fixture must exceed the old default');
  assert.ok(realisticToken.length < MAX_TASK_TOKEN_LENGTH);

  assert.equal(
    requireString(realisticToken, 'taskToken', { max: MAX_TASK_TOKEN_LENGTH }),
    realisticToken,
  );
  // And the default really is what rejected it, so this test would have caught it.
  assert.throws(() => requireString(realisticToken, 'taskToken'), /at most 200/);
});
