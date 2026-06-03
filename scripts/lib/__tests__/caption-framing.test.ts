import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickFraming, framingInstruction, type CaptionFraming } from '../caption-framing';

// Weights are third_person 0.40, capability 0.35, invitation 0.25
// → cumulative boundaries at 0.40 and 0.75.

test('pickFraming returns third_person for rng below 0.40', () => {
  assert.equal(pickFraming(() => 0.0), 'third_person');
  assert.equal(pickFraming(() => 0.39), 'third_person');
});

test('pickFraming returns capability for rng in [0.40, 0.75)', () => {
  assert.equal(pickFraming(() => 0.40), 'capability');
  assert.equal(pickFraming(() => 0.74), 'capability');
});

test('pickFraming returns invitation for rng at/above 0.75', () => {
  assert.equal(pickFraming(() => 0.75), 'invitation');
  assert.equal(pickFraming(() => 0.999), 'invitation');
});

test('pickFraming falls back to invitation for rng === 1.0 (float drift)', () => {
  assert.equal(pickFraming(() => 1.0), 'invitation');
});

test('pickFraming never returns an out-of-enum value across the range', () => {
  const valid = new Set<CaptionFraming>(['third_person', 'capability', 'invitation']);
  for (let i = 0; i < 100; i++) {
    const r = i / 100;
    assert.ok(valid.has(pickFraming(() => r)), `rng=${r} produced an invalid framing`);
  }
});

test('framingInstruction returns distinct, non-empty text per framing', () => {
  const a = framingInstruction('third_person');
  const b = framingInstruction('capability');
  const c = framingInstruction('invitation');
  assert.ok(a.length > 0 && b.length > 0 && c.length > 0);
  assert.notEqual(a, b);
  assert.notEqual(b, c);
  assert.notEqual(a, c);
});

test('framingInstruction third_person voice instructs third-person and bans ownership', () => {
  const instruction = framingInstruction('third_person');
  assert.match(instruction, /third person/i);
  assert.match(instruction, /never as your own/i);
});

import { buildUserPrompt, type ContentItem } from '../../generate-script';

test('buildUserPrompt injects the framing instruction for reveal items', () => {
  const item: ContentItem = {
    id: 'x',
    content_type: 'reveal',
    photo_era: '1960s',
    photo_story: 'A wedding photo found water-damaged.',
  };
  const prompt = buildUserPrompt(item, 'capability');
  assert.match(prompt, /APP CAPABILITY DEMO/);
});

test('buildUserPrompt for a tip item contains no framing instruction', () => {
  const item: ContentItem = {
    id: 'y',
    content_type: 'tip',
    tip_title: 'Scan at 600 DPI',
    tip_body: 'Higher DPI preserves detail for restoration.',
  };
  const prompt = buildUserPrompt(item);
  assert.doesNotMatch(prompt, /APP CAPABILITY DEMO|THIRD-PERSON STORY|VIEWER INVITATION/);
});

test('buildUserPrompt omits framing when none is passed for a reveal', () => {
  const item: ContentItem = { id: 'z', content_type: 'reveal', photo_era: '1940s' };
  const prompt = buildUserPrompt(item);
  assert.doesNotMatch(prompt, /Framing:/);
});
