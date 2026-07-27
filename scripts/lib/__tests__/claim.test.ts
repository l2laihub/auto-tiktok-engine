import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLAIM_TTL_MS, staleCutoff, claimableFilter } from '../claim';

test('CLAIM_TTL_MS is 30 minutes', () => {
  assert.equal(CLAIM_TTL_MS, 30 * 60 * 1000);
});

test('staleCutoff is TTL milliseconds before the given instant', () => {
  const now = Date.parse('2026-07-26T12:00:00Z');
  assert.equal(staleCutoff(now), '2026-07-26T11:30:00.000Z');
});

test('staleCutoff defaults to now', () => {
  const before = Date.now() - CLAIM_TTL_MS;
  const cutoff = Date.parse(staleCutoff());
  // Within a second of "TTL ago" in either direction.
  assert.ok(Math.abs(cutoff - before) < 1000, `cutoff drifted: ${cutoff - before}ms`);
});

test('claimableFilter matches unclaimed rows or claims older than the cutoff', () => {
  assert.equal(
    claimableFilter('2026-07-26T11:30:00.000Z'),
    'claimed_at.is.null,claimed_at.lt.2026-07-26T11:30:00.000Z',
  );
});
