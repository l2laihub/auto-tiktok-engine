process.env.TZ = 'America/Los_Angeles';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toLocalInput,
  fromLocalInput,
  localDateKey,
  formatDateTime,
  dayKeyToISO,
} from '../../../public/schedule-time.js';

test('toLocalInput formats an ISO instant into a local datetime-local value', () => {
  // 2026-05-31T13:00:00Z == 06:00 PDT
  assert.equal(toLocalInput('2026-05-31T13:00:00Z'), '2026-05-31T06:00');
});

test('toLocalInput returns empty string for null/invalid', () => {
  assert.equal(toLocalInput(null), '');
  assert.equal(toLocalInput(''), '');
  assert.equal(toLocalInput('not-a-date'), '');
});

test('fromLocalInput converts a local datetime-local value to a UTC ISO string', () => {
  // 09:00 PDT == 16:00 UTC
  assert.equal(fromLocalInput('2026-05-31T09:00'), '2026-05-31T16:00:00.000Z');
});

test('fromLocalInput returns null for empty input', () => {
  assert.equal(fromLocalInput(''), null);
  assert.equal(fromLocalInput(null), null);
});

test('toLocalInput/fromLocalInput round-trip on minute-aligned instants', () => {
  const iso = '2026-12-25T16:30:00.000Z';
  assert.equal(fromLocalInput(toLocalInput(iso)), iso);
});

test('localDateKey buckets an instant by its LOCAL calendar date', () => {
  // 2026-06-01T05:00:00Z == 2026-05-31 22:00 PDT -> still May 31 locally
  assert.equal(localDateKey('2026-06-01T05:00:00Z'), '2026-05-31');
  assert.equal(localDateKey('2026-05-31T13:00:00Z'), '2026-05-31');
});

test('formatDateTime renders a short local date + time label', () => {
  assert.equal(formatDateTime('2026-05-31T16:00:00Z'), 'May 31, 9:00 AM');
});

test('dayKeyToISO defaults to 06:00 local when no time provided', () => {
  assert.equal(dayKeyToISO('2026-05-31'), '2026-05-31T13:00:00.000Z');
});

test('dayKeyToISO preserves the time-of-day from an existing instant', () => {
  // existing instant is 09:00 PDT; moving to a new day keeps 09:00 PDT
  assert.equal(
    dayKeyToISO('2026-06-10', '2026-05-31T16:00:00Z'),
    '2026-06-10T16:00:00.000Z'
  );
});

test('dayKeyToISO returns null for empty dateKey', () => {
  assert.equal(dayKeyToISO(''), null);
});
