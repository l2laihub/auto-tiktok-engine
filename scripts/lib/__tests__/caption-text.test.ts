import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampCaption,
  buildFactualLine,
  buildPairCaptionPrompt,
  parsePairCaptions,
} from '../caption-text';

test('clampCaption collapses whitespace and trims', () => {
  assert.equal(clampCaption('  Her   smile,\n alive  '), 'Her smile, alive');
});

test('clampCaption hard-caps long text with an ellipsis', () => {
  const out = clampCaption('x'.repeat(60), 40);
  assert.equal(out.length, 40);
  assert.match(out, /…$/);
});

test('buildFactualLine joins label, location and era', () => {
  assert.equal(
    buildFactualLine({ label: "Grandma's wedding", location: 'Saigon', era: '1962' }),
    "Grandma's wedding · Saigon, 1962"
  );
});

test('buildFactualLine drops a missing location', () => {
  assert.equal(
    buildFactualLine({ label: "Grandma's wedding", era: '1962' }),
    "Grandma's wedding · 1962"
  );
});

test('buildFactualLine returns just the place when label is missing', () => {
  assert.equal(buildFactualLine({ location: 'Saigon', era: '1962' }), 'Saigon, 1962');
});

test('buildFactualLine returns empty string when nothing is provided', () => {
  assert.equal(buildFactualLine({}), '');
});

test('buildPairCaptionPrompt includes per-pair context and the count', () => {
  const p = buildPairCaptionPrompt([
    { label: "Grandma's wedding", era: '1962', location: 'Saigon', story: 'A cherished portrait.', damage_notes: 'water stains' },
  ]);
  assert.match(p, /exactly 1 object/);
  assert.match(p, /Grandma's wedding/);
  assert.match(p, /Saigon/);
  assert.match(p, /water stains/);
});

test('parsePairCaptions returns one clamped object per pair, in order', () => {
  const raw = '```json\n[{"before":"Found in a flooded album","after":"Her smile, alive again"}]\n```';
  const out = parsePairCaptions(raw, 1);
  assert.deepEqual(out, [{ before: 'Found in a flooded album', after: 'Her smile, alive again' }]);
});

test('parsePairCaptions pads missing entries with empty captions', () => {
  const out = parsePairCaptions('[{"before":"A","after":"B"}]', 2);
  assert.equal(out.length, 2);
  assert.deepEqual(out[1], { before: '', after: '' });
});

test('parsePairCaptions throws on non-JSON', () => {
  assert.throws(() => parsePairCaptions('not json', 1), /invalid JSON/);
});
