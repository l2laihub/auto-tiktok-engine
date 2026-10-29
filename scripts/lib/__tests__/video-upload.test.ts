import { test } from 'node:test';
import assert from 'node:assert/strict';
import { targetVideoKbps } from '../video-upload';

test('targetVideoKbps leaves headroom under the cap', () => {
  const max = 50 * 1024 * 1024;
  const kbps = targetVideoKbps(max, 60);
  const bytes = ((kbps + 128) * 1000 * 60) / 8;
  assert.ok(bytes < max * 0.95, `${bytes} should be < 95% of ${max}`);
  assert.ok(bytes > max * 0.8, `${bytes} should use most of the budget`);
});

test('targetVideoKbps floors very long clips', () => {
  assert.equal(targetVideoKbps(50 * 1024 * 1024, 100_000), 300);
});
