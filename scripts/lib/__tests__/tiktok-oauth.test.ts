import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAccountId, fetchUserInfo } from '../tiktok-oauth';

test('normalizeAccountId: empty means the default account', () => {
  assert.equal(normalizeAccountId(undefined), 'default');
  assert.equal(normalizeAccountId(''), 'default');
  assert.equal(normalizeAccountId('   '), 'default');
});

test('normalizeAccountId: slugs are lowercased and trimmed', () => {
  assert.equal(normalizeAccountId(' NK-Nails '), 'nk-nails');
  assert.equal(normalizeAccountId('lucky.nails_boca'), 'lucky.nails_boca');
});

test('normalizeAccountId: rejects anything that is not a plain slug', () => {
  assert.equal(normalizeAccountId('nk nails'), null);
  assert.equal(normalizeAccountId('-leading-dash'), null);
  assert.equal(normalizeAccountId('drop/table'), null);
  assert.equal(normalizeAccountId('a'.repeat(41)), null);
  assert.equal(normalizeAccountId(42), null);
});

test('fetchUserInfo asks for username only when the profile scope was granted', async () => {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    urls.push(url);
    return { json: async () => ({ data: { user: {} } }) };
  }) as unknown as typeof fetch;
  try {
    await fetchUserInfo('token', 'user.info.basic,video.upload');
    await fetchUserInfo('token', 'user.info.basic,user.info.profile');
    assert.ok(!urls[0].includes('username'), 'basic scope must not request username');
    assert.ok(urls[1].includes('username'), 'profile scope should request username');
  } finally {
    globalThis.fetch = original;
  }
});

test('fetchUserInfo pulls the profile out of the TikTok envelope', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({
    json: async () => ({
      data: { user: { open_id: 'abc', display_name: 'NK Nails', username: 'nknailsseattle' } },
    }),
  })) as unknown as typeof fetch;
  try {
    assert.deepEqual(await fetchUserInfo('token', 'user.info.profile'), {
      openId: 'abc',
      displayName: 'NK Nails',
      username: 'nknailsseattle',
    });
  } finally {
    globalThis.fetch = original;
  }
});

test('fetchUserInfo returns nulls instead of throwing on an error response', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({
    json: async () => ({ error: { code: 'access_token_invalid' } }),
  })) as unknown as typeof fetch;
  try {
    assert.deepEqual(await fetchUserInfo('token'), {
      openId: null,
      displayName: null,
      username: null,
    });
  } finally {
    globalThis.fetch = original;
  }

  globalThis.fetch = (async () => { throw new Error('network down'); }) as unknown as typeof fetch;
  try {
    assert.equal((await fetchUserInfo('token')).username, null);
  } finally {
    globalThis.fetch = original;
  }
});
