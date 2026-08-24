const test = require('node:test');
const assert = require('node:assert/strict');
const {
  POINTS_PER_LEVEL,
  POINTS_PER_PURCHASE,
  levelFor,
  levelsCrossed,
} = require('pokedex-utils');

test('a purchase is worth less than a level, so a level is a real threshold', () => {
  // The whole point of the watermark exists only because this is true. If one
  // purchase were one level, the consumer would never have to work out which
  // levels a purchase crossed.
  assert.ok(POINTS_PER_PURCHASE < POINTS_PER_LEVEL);
  assert.equal(POINTS_PER_LEVEL % POINTS_PER_PURCHASE, 0);
});

test('levelFor floors the points at the threshold', () => {
  assert.equal(levelFor(0), 0);
  assert.equal(levelFor(50), 0);
  assert.equal(levelFor(100), 1);
  assert.equal(levelFor(199), 1);
  assert.equal(levelFor(200), 2);
});

test('levelFor treats a missing or nonsense total as level zero', () => {
  // The LEVEL item does not exist until the first purchase, so the read route
  // asks for the level of an absent item on every new user.
  assert.equal(levelFor(undefined), 0);
  assert.equal(levelFor(null), 0);
  assert.equal(levelFor('100'), 0);
  assert.equal(levelFor(-100), 0);
  assert.equal(levelFor(NaN), 0);
});

test('levelsCrossed announces every level between the watermark and the total', () => {
  assert.deepEqual(levelsCrossed(0, 1), [1]);
  assert.deepEqual(levelsCrossed(1, 2), [2]);
  // Two purchases landing together can cross two thresholds at once. Returning
  // only the last one would silently drop the badge for level 2.
  assert.deepEqual(levelsCrossed(1, 3), [2, 3]);
});

test('levelsCrossed starts at level 1 when nothing was ever published', () => {
  // A LEVEL item written before this attribute existed has no publishedLevel,
  // and neither does a brand new one.
  assert.deepEqual(levelsCrossed(undefined, 2), [1, 2]);
  assert.deepEqual(levelsCrossed(null, 1), [1]);
});

test('levelsCrossed returns nothing once the watermark has caught up', () => {
  // This is what makes a redelivered SQS message publish no second event: the
  // points were already counted, so the watermark already equals the total.
  assert.deepEqual(levelsCrossed(3, 3), []);
  assert.deepEqual(levelsCrossed(0, 0), []);
  // And a watermark ahead of the total - a level item edited by hand, or an
  // event replayed out of order - must not produce a negative range.
  assert.deepEqual(levelsCrossed(5, 3), []);
});
