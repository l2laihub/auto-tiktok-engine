import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REVEAL_THEMES,
  REVEAL_DAMAGES,
  TIP_TOPICS,
  pickDistinct,
  suggestRevealInputs,
  suggestTipInputs,
} from '../../../public/ai-suggestions.js';

test('curated pools are non-empty arrays of strings', () => {
  for (const pool of [REVEAL_THEMES, REVEAL_DAMAGES, TIP_TOPICS]) {
    assert.ok(Array.isArray(pool) && pool.length > 0);
    assert.ok(pool.every((x) => typeof x === 'string' && x.length > 0));
  }
});

test('pickDistinct never returns the current value when pool has >= 2 items', () => {
  const pool = ['a', 'b', 'c'];
  // rng forced low -> first candidate; forced high -> last candidate. Neither is 'b'.
  assert.equal(pickDistinct(pool, 'b', () => 0), 'a');
  assert.equal(pickDistinct(pool, 'b', () => 0.99), 'c');
});

test('pickDistinct returns the lone item for a single-element pool', () => {
  assert.equal(pickDistinct(['x'], 'x'), 'x');
});

test('pickDistinct returns an element when current is null/undefined', () => {
  assert.equal(pickDistinct(['a', 'b'], null, () => 0), 'a');
  assert.equal(pickDistinct(['a', 'b'], undefined, () => 0.99), 'b');
});

test('pickDistinct returns undefined for an empty pool', () => {
  assert.equal(pickDistinct([], 'a'), undefined);
});

test('suggestRevealInputs returns {hint, damageNotes} drawn from the reveal pools', () => {
  const r = suggestRevealInputs();
  assert.ok(REVEAL_THEMES.includes(r.hint));
  assert.ok(REVEAL_DAMAGES.includes(r.damageNotes));
});

test('suggestRevealInputs excludes the previous values', () => {
  const prev = { hint: REVEAL_THEMES[1], damageNotes: REVEAL_DAMAGES[1] };
  const r = suggestRevealInputs(prev, () => 0);
  assert.notEqual(r.hint, prev.hint);
  assert.notEqual(r.damageNotes, prev.damageNotes);
});

test('suggestTipInputs returns {hint} drawn from TIP_TOPICS, excluding prev', () => {
  const r = suggestTipInputs();
  assert.ok(TIP_TOPICS.includes(r.hint));
  const prev = { hint: TIP_TOPICS[1] };
  assert.notEqual(suggestTipInputs(prev, () => 0).hint, prev.hint);
});
