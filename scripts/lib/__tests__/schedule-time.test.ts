process.env.TZ = 'America/Los_Angeles';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toLocalInput,
  fromLocalInput,
  localDateKey,
  formatDateTime,
  dayKeyToISO,
  addDays,
  startOfWeek,
  periodDays,
  shiftAnchor,
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

// ===== calendar view helpers =====

const key = (d: Date) => localDateKey(d);

test('periodDays returns exactly one day for the day view', () => {
  assert.deepEqual(periodDays('day', new Date(2026, 7, 18)).map(key), ['2026-08-18']);
});

test('periodDays week view spans Sunday through Saturday around the anchor', () => {
  // Aug 18 2026 is a Tuesday
  assert.deepEqual(
    periodDays('week', new Date(2026, 7, 18)).map(key),
    ['2026-08-16', '2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22']
  );
});

test('periodDays month view pads to whole weeks and covers every day of the month', () => {
  const days = periodDays('month', new Date(2026, 7, 18)).map(key);
  assert.equal(days.length % 7, 0, 'grid must stay 7 columns wide');
  assert.equal(days[0], '2026-07-26', 'starts on the Sunday before Aug 1');
  assert.equal(days[days.length - 1], '2026-09-05', 'ends on the Saturday after Aug 31');
  for (let day = 1; day <= 31; day++) {
    assert.ok(days.includes(`2026-08-${String(day).padStart(2, '0')}`), `missing Aug ${day}`);
  }
});

test('shiftAnchor steps by the size of the current view', () => {
  const anchor = new Date(2026, 7, 18);
  assert.equal(key(shiftAnchor('day', anchor, 1)), '2026-08-19');
  assert.equal(key(shiftAnchor('day', anchor, -1)), '2026-08-17');
  assert.equal(key(shiftAnchor('week', anchor, 1)), '2026-08-25');
  assert.equal(key(shiftAnchor('month', anchor, 1)), '2026-09-01');
});

test('shiftAnchor from a 31st does not skip a short month', () => {
  // naive month arithmetic on Jan 31 lands in March; anchoring to the 1st does not
  assert.equal(key(shiftAnchor('month', new Date(2026, 0, 31), 1)), '2026-02-01');
});

test('addDays crosses a DST boundary without drifting off midnight', () => {
  // US DST ends Nov 1 2026; Oct 31 + 1 day must still be local midnight Nov 1
  const next = addDays(new Date(2026, 9, 31), 1);
  assert.equal(key(next), '2026-11-01');
  assert.equal(next.getHours(), 0);
});

test('startOfWeek on a Sunday returns that same Sunday', () => {
  assert.equal(key(startOfWeek(new Date(2026, 7, 16))), '2026-08-16');
});
