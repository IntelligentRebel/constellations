import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PREDEFINED_RACES, advantagePoints, habitability, gravString } from '../src/engine/race';

test('advantage points of predefined races match Stars! 2.70j', () => {
  const expected: Record<string, number> = { Humanoid: 25, Rabbitoid: 32, Insectoid: 43, Nucleotid: 11, Silicanoid: 9, Antetheral: 7 };
  for (const [k, v] of Object.entries(expected)) {
    assert.equal(advantagePoints(PREDEFINED_RACES[k]()), v, k);
  }
});

test('habitability (craig-stars validated cases)', () => {
  const h = PREDEFINED_RACES.Humanoid();
  assert.equal(habitability(h, [50, 50, 50]), 100);
  assert.equal(habitability(h, [15, 50, 50]), 41);
  assert.equal(habitability(h, [1, 50, 50]), -14);
  assert.equal(habitability(h, [100, 50, 50]), -15);
  assert.equal(habitability(h, [1, 100, 50]), -29);
  assert.equal(habitability(h, [48, 50, 50]), 99);
});

test('gravity display', () => {
  assert.equal(gravString(50), '1.00g');
  assert.equal(gravString(0), '0.12g');
  assert.equal(gravString(30), '0.55g');
  assert.equal(gravString(100), '8.00g');
});
