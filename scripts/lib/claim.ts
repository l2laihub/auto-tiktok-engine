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
  if (count === null) {
    throw new Error('Failed to claim item: no row count returned (Prefer: count=exact not applied?)');
  }
  if (count === 0) return null; // another instance won

  const { data, error: fetchError } = await supabase
    .from('tiktok_content_pool')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchError) throw new Error(`Failed to fetch claimed item: ${fetchError.message}`);
  return data as T;
}
