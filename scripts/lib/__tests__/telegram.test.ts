import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInboxMessage, resolveThumbnail, buildDashboardUrl, isTelegramConfigured } from '../telegram';

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

test('resolveThumbnail picks the first reveal pair after_url', () => {
  const item = { id: 'x', content_type: 'reveal' as const, image_pairs: [{ after_url: 'https://x.test/a.png' }] };
  assert.equal(resolveThumbnail(item), 'https://x.test/a.png');
});

test('resolveThumbnail falls back to legacy after_image_url for reveals', () => {
  const item = { id: 'x', content_type: 'reveal' as const, after_image_url: 'https://x.test/legacy.png' };
  assert.equal(resolveThumbnail(item), 'https://x.test/legacy.png');
});

test('resolveThumbnail prefers tip_image_url for tips', () => {
  const item = { id: 'x', content_type: 'tip' as const, tip_image_url: 'https://x.test/tip.png', tip_images: ['https://x.test/other.png'] };
  assert.equal(resolveThumbnail(item), 'https://x.test/tip.png');
});

test('resolveThumbnail falls back to tip_images[0] then tips[0].tipImageSrc', () => {
  assert.equal(
    resolveThumbnail({ id: 'x', content_type: 'tip' as const, tip_images: ['https://x.test/i0.png'] }),
    'https://x.test/i0.png'
  );
  assert.equal(
    resolveThumbnail({ id: 'x', content_type: 'tip' as const, tips: [{ tipImageSrc: 'https://x.test/t0.png' }] }),
    'https://x.test/t0.png'
  );
});

test('resolveThumbnail returns undefined when nothing is available', () => {
  assert.equal(resolveThumbnail({ id: 'x', content_type: 'reveal' as const }), undefined);
});

test('buildDashboardUrl builds an #item-<shortId> deep link from a base url', () => {
  assert.equal(
    buildDashboardUrl('a1b2c3d4e5f6', 'http://192.168.1.50:3001'),
    'http://192.168.1.50:3001/#item-a1b2c3d4'
  );
});

test('buildDashboardUrl strips a trailing slash on the base url', () => {
  assert.equal(
    buildDashboardUrl('a1b2c3d4e5f6', 'http://192.168.1.50:3001/'),
    'http://192.168.1.50:3001/#item-a1b2c3d4'
  );
});

test('buildDashboardUrl returns undefined without a base url', () => {
  assert.equal(buildDashboardUrl('a1b2c3d4e5f6', undefined), undefined);
  assert.equal(buildDashboardUrl('a1b2c3d4e5f6', ''), undefined);
});

test('isTelegramConfigured reflects both env vars being present', () => {
  const origToken = process.env.TELEGRAM_BOT_TOKEN;
  const origChat = process.env.TELEGRAM_CHAT_ID;
  try {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    assert.equal(isTelegramConfigured(), false);
    process.env.TELEGRAM_BOT_TOKEN = 'tok';
    assert.equal(isTelegramConfigured(), false);
    process.env.TELEGRAM_CHAT_ID = '123';
    assert.equal(isTelegramConfigured(), true);
  } finally {
    if (origToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = origToken;
    if (origChat === undefined) delete process.env.TELEGRAM_CHAT_ID; else process.env.TELEGRAM_CHAT_ID = origChat;
  }
});
