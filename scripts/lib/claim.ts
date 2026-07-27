import type { SupabaseClient } from '@supabase/supabase-js';

// A claim older than this is assumed abandoned by a crashed run. A post takes
// seconds to minutes, so this can never fire on a healthy run — it only bounds
// how long a container restart can strand an item.
export const CLAIM_TTL_MS = 30 * 60 * 1000;

/** The instant before which a claim counts as stale. */
export function staleCutoff(now: number = Date.now()): string {
  return new Date(now - CLAIM_TTL_MS).toISOString();
}

/** PostgREST `or=` filter for "nobody holds this, or the holder is gone". */
export function claimableFilter(cutoff: string): string {
  return `claimed_at.is.null,claimed_at.lt.${cutoff}`;
}

/**
 * The next due item's id, or null when nothing is due. 'rendered' is included
 * so items rendered ahead of their scheduled date still get posted without
 * re-rendering.
 *
 * The two .or() calls combine as (scheduled…) AND (claimable…) — PostgREST
 * ANDs repeated or= params.
 */
export async function selectNextCandidate(
  supabase: SupabaseClient,
  cutoff: string,
): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from('tiktok_content_pool')
    .select('id')
    .in('status', ['queued', 'scripted', 'rendered'])
    .or('scheduled_for.is.null,scheduled_for.lte.now()')
    .or(claimableFilter(cutoff))
    .order('scheduled_for', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  if (error?.code === 'PGRST116') return null; // no rows
  if (error) throw new Error(`Failed to fetch next item: ${error.message}`);
  return data;
}

/**
 * Take ownership of one row and return it. This is a single UPDATE, so
 * Postgres row-locks it and exactly one caller's WHERE still matches; the
 * loser's WHERE matches zero rows. Atomicity comes from that WHERE clause,
 * not from anything we do here — but the winner has to be identified by the
 * updated row *count*, not by asking PostgREST to hand back the row.
 *
 * Why: our filter is `.or(claimableFilter(cutoff))`, which references
 * claimed_at — the very column this UPDATE sets. PostgREST re-applies that
 * filter against each row's *new* values when building the response
 * representation, so a row we just claimed no longer matches "claimable"
 * and the representation comes back empty even though the UPDATE
 * committed. `.select().single()` doesn't just misreport that — expecting
 * exactly one row back and getting zero makes it error out and roll back
 * the write entirely, so claiming would never succeed at all, winner or
 * not. Do not go back to `.select()`/`.single()` here.
 *
 * So: update with `count: 'exact'` and no `.select()`, use `count === 1`
 * to know we won, then re-fetch the row separately — safe now, since we
 * own it.
 *
 * Never released: 'posted' and 'failed' both fall outside the pickup filter,
 * so a stale claim on a finished row is invisible.
 */
export async function claimItem<T>(
  supabase: SupabaseClient,
  id: string,
  cutoff: string,
): Promise<T | null> {
  const { count, error } = await supabase
    .from('tiktok_content_pool')
    .update({ claimed_at: new Date().toISOString() }, { count: 'exact' })
    .eq('id', id)
    .or(claimableFilter(cutoff));

  if (error) throw new Error(`Failed to claim item: ${error.message}`);
  // Fail closed: only a literal 1 means we won. Anything else — 0, null, or
  // (if postgrest-js ever parses a malformed Content-Range as NaN) neither —
  // must NOT fall through to "we won" by default.
  if (!Number.isInteger(count)) {
    throw new Error(
      `Claim returned no usable row count (${count}) — Prefer: count=exact may not have reached PostgREST`,
    );
  }
  if (count !== 1) return null; // another instance won (count === 0)

  // A second, non-transactional request — the row could theoretically be
  // deleted (dashboard) between the UPDATE above and this SELECT, in which
  // case .single() raises and this throws rather than returning null; or
  // edited concurrently, in which case the returned object may not be
  // exactly the version our claim predicate matched. Both windows are
  // narrow and bounded by CLAIM_TTL_MS, not indefinite.
  const { data, error: fetchError } = await supabase
    .from('tiktok_content_pool')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchError) throw new Error(`Failed to fetch claimed item: ${fetchError.message}`);
  return data as T;
}

/**
 * Give back a claim taken by a run that will not post — a dry run, in
 * practice. Without this, previewing a due item (e.g. the dashboard's
 * re-render button) claims it and then never touches `claimed_at` again,
 * since `postToTikTok` early-returns for dry runs before reaching the code
 * that would otherwise leave the claim in place on purpose. The row then sits
 * claimed for up to CLAIM_TTL_MS, delaying the real post.
 *
 * Real runs must NOT call this: 'posted' and 'failed' both fall outside the
 * pickup filter, so leaving `claimed_at` set on a finished row is correct and
 * intentional (see claimItem's docstring) — releasing it here would just
 * re-open a already-handled row to a second claim.
 */
export async function releaseClaim(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase
    .from('tiktok_content_pool')
    .update({ claimed_at: null })
    .eq('id', id);

  if (error) throw new Error(`Failed to release claim: ${error.message}`);
}
