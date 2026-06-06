import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInboxMessage } from '../telegram';

const base = {
  caption: 'Grandma looked SO happy here 🥹 #photorestoration #familyhistory',
  contentId: 'a1b2c3d4e5f6',
  contentType: 'reveal',
};

test('buildInboxMessage puts the caption in a copyable <code> block', () => {
  const { text } = buildInboxMessage(base);
  assert.match(text, /<code>Grandma looked SO happy here 🥹 #photorestoration #familyhistory<\/code>/);
});

test('buildInboxMessage shows content type and short id', () => {
  const { text } = buildInboxMessage(base);
  assert.match(text, /reveal · a1b2c3d4/);
  assert.doesNotMatch(text, /a1b2c3d4e5f6/); // only the 8-char short id
});

test('buildInboxMessage HTML-escapes the caption', () => {
  const { text } = buildInboxMessage({ ...base, caption: 'Before & after <3' });
  assert.match(text, /<code>Before &amp; after &lt;3<\/code>/);
});

test('buildInboxMessage includes the Scheduled line only when scheduledFor is set', () => {
  const withTime = buildInboxMessage({ ...base, scheduledFor: '2026-06-06T16:00:00.000Z' });
  assert.match(withTime.text, /Scheduled:/);
  const without = buildInboxMessage(base);
  assert.doesNotMatch(without.text, /Scheduled:/);
});

test('buildInboxMessage includes the dashboard link only when dashboardUrl is set', () => {
  const withUrl = buildInboxMessage({ ...base, dashboardUrl: 'http://192.168.1.50:3001/#item-a1b2c3d4' });
  assert.match(withUrl.text, /<a href="http:\/\/192\.168\.1\.50:3001\/#item-a1b2c3d4">Open in dashboard<\/a>/);
  const without = buildInboxMessage(base);
  assert.doesNotMatch(without.text, /Open in dashboard/);
});

test('buildInboxMessage returns photoUrl when a thumbnailUrl is provided', () => {
  const { photoUrl } = buildInboxMessage({ ...base, thumbnailUrl: 'https://x.test/after.png' });
  assert.equal(photoUrl, 'https://x.test/after.png');
});

test('buildInboxMessage returns undefined photoUrl when no thumbnail', () => {
  const { photoUrl } = buildInboxMessage(base);
  assert.equal(photoUrl, undefined);
});
