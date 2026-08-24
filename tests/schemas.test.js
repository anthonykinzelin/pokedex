const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LEVEL_REACHED,
  PURCHASE_COMPLETED,
  parseEvent,
} = require('pokedex-utils');

const OCCURRED_AT = '2026-08-24T10:00:00.000Z';

function purchaseBody(overrides = {}) {
  return JSON.stringify({
    source: 'fr.pokemon.referential',
    'detail-type': 'purchase.completed',
    detail: {
      eventVersion: '1.0',
      purchaseId: 'p-1',
      userId: 'u-1',
      pokemonId: 'pikachu',
      occurredAt: OCCURRED_AT,
    },
    ...overrides,
  });
}

test('parseEvent returns the detail of a well-formed event', () => {
  assert.deepEqual(parseEvent(PURCHASE_COMPLETED, purchaseBody()), {
    eventVersion: '1.0',
    purchaseId: 'p-1',
    userId: 'u-1',
    pokemonId: 'pikachu',
    occurredAt: OCCURRED_AT,
  });
});

test('parseEvent rejects another source or another detail-type', () => {
  assert.throws(
    () => parseEvent(PURCHASE_COMPLETED, purchaseBody({ source: 'fr.pokemon.levels' })),
    /fr.pokemon.referential/,
  );
  assert.throws(
    () => parseEvent(PURCHASE_COMPLETED, purchaseBody({ 'detail-type': 'purchase.refunded' })),
    /purchase.completed/,
  );
});

test('parseEvent rejects an eventVersion this code was not written against', () => {
  const body = JSON.parse(purchaseBody());
  body.detail.eventVersion = '2.0';

  assert.throws(() => parseEvent(PURCHASE_COMPLETED, JSON.stringify(body)), /"1.0"/);
});

test('parseEvent accepts and strips an unknown detail field', () => {
  const body = JSON.parse(purchaseBody());
  body.detail.discountCode = 'SUMMER';

  const detail = parseEvent(PURCHASE_COMPLETED, JSON.stringify(body));

  assert.equal(detail.discountCode, undefined);
  assert.equal(detail.purchaseId, 'p-1');
});

test('parseEvent trims the identifiers and rejects blank ones', () => {
  const body = JSON.parse(purchaseBody());
  body.detail.userId = '  u-1  ';
  assert.equal(parseEvent(PURCHASE_COMPLETED, JSON.stringify(body)).userId, 'u-1');

  body.detail.userId = '   ';
  assert.throws(() => parseEvent(PURCHASE_COMPLETED, JSON.stringify(body)), /too_small/);
});

test('a level below 1 and a non-integer number of points are rejected', () => {
  const detail = {
    eventVersion: '1.0',
    userId: 'u-1',
    level: 2,
    points: 100,
    reachedAt: OCCURRED_AT,
  };

  assert.deepEqual(LEVEL_REACHED.detail.parse(detail), detail);
  assert.throws(() => LEVEL_REACHED.detail.parse({ ...detail, level: 0 }), /too_small/);
  assert.throws(() => LEVEL_REACHED.detail.parse({ ...detail, points: 1.5 }), /expected int/);
});

test('a publisher payload missing a field is rejected before PutEvents', () => {
  const { reachedAt, ...withoutReachedAt } = {
    eventVersion: '1.0',
    userId: 'u-1',
    level: 2,
    points: 100,
    reachedAt: OCCURRED_AT,
  };

  assert.throws(() => LEVEL_REACHED.detail.parse(withoutReachedAt), /reachedAt/);
});
