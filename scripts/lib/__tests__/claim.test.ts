import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { CLAIM_TTL_MS, staleCutoff, claimableFilter, claimItem, selectNextCandidate } from '../claim';

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

// npm test loads no .env, so this skips by default and runs explicitly with:
//   node --env-file=.env --import tsx --test scripts/lib/__tests__/claim.test.ts
const LIVE = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

test('two concurrent claims produce exactly one winner', { skip: !LIVE }, async () => {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // scheduled_for starts an hour in the FUTURE, not the past. claimItem only
  // filters on id and claimed_at (never scheduled_for), so the race below is
  // unaffected either way — but a due, unclaimed row would be immediately
  // visible to the real deployed scheduler (dashboard.huybuilds.app) polling
  // this same database every minute, which could steal the row between our
  // insert and our claims (spurious failure) and would log a post failure
  // against a row with no video_url. Do NOT "simplify" this back to a past
  // date — see Step 3 below, where we backdate it only after it's claimed.
  const { data: row, error: insertError } = await supabase
    .from('tiktok_content_pool')
    .insert({
      content_type: 'external',
      status: 'rendered',
      scheduled_for: new Date(Date.now() + 60 * 60_000).toISOString(),
      hook_text: 'CLAIM TEST — safe to delete',
    })
    .select()
    .single();
  assert.equal(insertError, null);

  try {
    const cutoff = staleCutoff();
    const [a, b] = await Promise.all([
      claimItem<{ id: string }>(supabase, row.id, cutoff),
      claimItem<{ id: string }>(supabase, row.id, cutoff),
    ]);

    const winners = [a, b].filter(Boolean);
    assert.equal(winners.length, 1, 'exactly one caller must win the claim');
    assert.equal(winners[0]!.id, row.id);

    // Now that the row is claimed (and thus already excluded from the
    // claimable filter), backdate it so the "not re-selected" assertion is
    // testing something real: a genuinely due row, excluded solely because
    // it's claimed — not just a row that isn't due yet.
    const { error: updateError } = await supabase
      .from('tiktok_content_pool')
      .update({ scheduled_for: new Date(Date.now() - 60_000).toISOString() })
      .eq('id', row.id);
    assert.equal(updateError, null);

    const next = await selectNextCandidate(supabase, cutoff);
    assert.notEqual(next?.id, row.id, 'a claimed row must not be re-selected');
  } finally {
    await supabase.from('tiktok_content_pool').delete().eq('id', row.id);
  }
});
