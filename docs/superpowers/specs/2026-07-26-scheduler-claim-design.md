# Scheduler Claim (stop two instances posting the same item)

**Date:** 2026-07-26 · **Status:** Design

## Goal

Make item pickup atomic across processes, so a due content-pool item is posted
to TikTok exactly once no matter how many dashboard instances are running.

## Problem

The scheduler guards concurrent runs with `pipelineRunning`
(`dashboard/server.ts:1140`), an in-process boolean. Two instances — the Coolify
deployment and a local `npm run dashboard` — poll the same
`tiktok_content_pool` every minute and neither can see the other's flag.

`fetchNextItem()` (`render-video.ts:111`) is a plain SELECT: it reads the next
due row and takes no ownership of it. Both instances therefore select the same
row and both post it.

The window is widest for exactly the case that matters most. An external item is
born `status='rendered'` and its status does not change again until *after* the
TikTok upload completes (`render-video.ts:731`) — a gap of seconds to minutes
for a 10–15 MB video. Everything the studio-ops `/video-post` queue step
produces is an external item.

This is pre-existing, but studio-ops is about to make "queue from the Mac, post
from the deployment" the normal flow, which turns "a local dashboard left open"
into a live double-post on a client's TikTok account.

## Why not claim by overwriting `status`

Tempting, and free: `status='rendering'` is already excluded from the pickup
filter *and* from the partial index `idx_content_pool_status_scheduled`. No
migration at all.

It breaks two downstream branches that read `item.status`:

- `ensureScript` (`render-video.ts:143`) — `status !== 'queued'` means "script
  already exists, skip generation". A claimed `queued` item would never get its
  script.
- `alreadyRendered` (`render-video.ts:843`) — `status === 'rendered' &&
  video_url` is the post-only short-circuit. A claimed pre-rendered item would
  lose it and try to re-render.

Preserving the pre-claim status in the returned object papers over both, but
then every downstream read is disagreeing with the database. Not worth the
saved column.

## Design — a claim column, status machine untouched

### 1. Schema (`supabase/migration-v7-claim.sql`)

```sql
ALTER TABLE tiktok_content_pool ADD COLUMN claimed_at TIMESTAMPTZ;

DROP INDEX IF EXISTS idx_content_pool_status_scheduled;
CREATE INDEX idx_content_pool_status_scheduled
  ON tiktok_content_pool (status, scheduled_for, claimed_at)
  WHERE status IN ('queued', 'scripted', 'rendered');
```

`claimed_at IS NULL` means unclaimed. No enum change, no status semantics
touched, so no downstream branch moves.

### 2. Claim in `fetchNextItem()` (`scripts/render-video.ts`)

The candidate SELECT gains a claim predicate, and the claim itself is a
conditional UPDATE, row-locked by Postgres so exactly one caller's `WHERE`
still matches. The winner is identified by the affected-row **count**, not by
asking PostgREST to hand the row back:

```ts
const CLAIM_TTL_MS = 30 * 60 * 1000;
const cutoff = new Date(Date.now() - CLAIM_TTL_MS).toISOString();

// candidate SELECT: unchanged, plus
  .or(`claimed_at.is.null,claimed_at.lt.${cutoff}`)

// then claim it — one UPDATE, row-locked by Postgres, exactly one winner
const { count, error } = await supabase
  .from('tiktok_content_pool')
  .update({ claimed_at: new Date().toISOString() }, { count: 'exact' })
  .eq('id', candidate.id)
  .or(`claimed_at.is.null,claimed_at.lt.${cutoff}`);

if (error) throw new Error(/* ... */);
if (count !== 1) return null; // lost the race (or a malformed count — fail closed)

// We own the row now, so a second, separate SELECT to read it back is safe.
const { data: claimed } = await supabase
  .from('tiktok_content_pool')
  .select('*')
  .eq('id', candidate.id)
  .single();
```

Two `.or()` calls on one query combine as `(scheduled…) AND (claimed…)`, which
is what we want.

Losing the race returns `null` rather than looping to the next candidate. The
poller runs every minute, so the next item is picked up a minute later — not
worth a retry loop for a two-instance deployment.

Both entry points claim: the by-id path (`fetchNextItem(specificId)`) claims
too, so a manual "post this now" cannot collide with the cron.

**Tried first, and rejected: `.update(...).select().single()`.** The obvious
shape — let PostgREST hand back the updated row, treat a non-null result as
"I won" — does not work, because PostgREST re-applies the request's `or=`
filter (`claimed_at.is.null,claimed_at.lt.<cutoff>`) when it builds the
response *representation*, evaluating it against each row's post-UPDATE
values. A row this UPDATE just claimed has a fresh `claimed_at`, so it no
longer matches its own claim predicate: the representation comes back empty
even though the write committed. Worse, `.single()` expects exactly one row
and errors on zero, which rolls the UPDATE back entirely — so with this
shape, claiming can never succeed at all, winner or not. The count-based
UPDATE above sidesteps the problem by never asking PostgREST to re-match the
row it just changed; a second, ordinary SELECT (safe now that we own the row)
fetches the data.

### 3. Recovery is the TTL, not a release

No explicit release. A run that ends in `posted` or `failed` leaves
`claimed_at` set, and both statuses are already outside the pickup filter, so
the stale claim is invisible.

The only case that needs recovery is a hard crash mid-run (container restart,
OOM) which leaves the row in a pickable status with a live claim. The 30-minute
TTL makes it pickable again. A post takes seconds to minutes, so the TTL cannot
fire on a healthy run.

Consequence worth stating plainly: a crashed post retries up to 30 minutes
late, and a manual retry of a genuinely stuck item is blocked for that long.
Manual runs are supervised, so this is a wait, not a failure.

## Failure direction

This fails **closed**: a bug in the claim predicate means everything looks
claimed and nothing posts, silently. That is the safer direction than
double-posting to a client account, and the TTL bounds it at 30 minutes, but it
is a silent failure — worth watching the dashboard pool view after deploy.

## Testing

The atomicity is a database property. A unit test over a pure helper would
prove nothing, so the meaningful test hits real Supabase:

`scripts/lib/__tests__/claim.test.ts` — insert a dummy due row, fire two
`fetchNextItem()` calls concurrently, assert exactly one returns it and the
other returns `null`, then delete the row.

This is the first test in the suite that needs network and credentials; the
existing `npm test` files are all pure functions. It skips (not fails) when
`SUPABASE_SERVICE_ROLE_KEY` is absent, so `npm test` still passes on a machine
without the env.

Manual verification: run two dashboards against the same Supabase with a due
external item and confirm one posts.

## Out of scope

- Replacing the poller with `SELECT … FOR UPDATE SKIP LOCKED` in an RPC. That
  is the textbook queue, but it needs a Postgres function and buys nothing over
  a conditional UPDATE at this volume.
- A worker identity column (`claimed_by`). Nothing needs to know *which*
  instance won.
- Retiring `pipelineRunning`. It still correctly prevents one instance from
  running two pipelines at once; the DB claim handles the cross-instance case.
