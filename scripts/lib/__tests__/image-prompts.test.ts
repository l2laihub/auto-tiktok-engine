import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBeforePrompt, type PhotoSubject } from '../image-prompts';

const subject: PhotoSubject = {
  subject: 'a young couple on their wedding day',
  era: '1960s',
  story: 'A cherished wedding portrait.',
  label: "Grandma's wedding",
  location: 'Saigon',
};

test('buildBeforePrompt includes the subject and era', () => {
  const p = buildBeforePrompt(subject);
  assert.match(p, /young couple on their wedding day/);
  assert.match(p, /1960s/);
});

test('buildBeforePrompt requests dramatic, heavy damage by default', () => {
  const p = buildBeforePrompt(subject).toLowerCase();
  assert.match(p, /tear|torn|rip/);
  assert.match(p, /missing corner|torn corner/);
  assert.match(p, /water stain|water damage|moisture/);
  assert.match(p, /crease|fold/);
  assert.match(p, /mold|foxing/);
  assert.match(p, /fad(e|ing)|yellow/);
});

test('buildBeforePrompt keeps the no-text guardrail', () => {
  const p = buildBeforePrompt(subject).toLowerCase();
  assert.match(p, /no text/);
});

test('buildBeforePrompt appends damageNotes when provided', () => {
  const p = buildBeforePrompt(subject, 'water-damaged 1960s Polaroid, mildew');
  assert.match(p, /water-damaged 1960s Polaroid, mildew/);
});

test('buildBeforePrompt omits the damage-notes clause when not provided', () => {
  const p = buildBeforePrompt(subject);
  assert.doesNotMatch(p, /Additional damage\/style direction/);
});
