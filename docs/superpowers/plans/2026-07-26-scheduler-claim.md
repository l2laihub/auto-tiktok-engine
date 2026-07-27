# Scheduler Claim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make content-pool pickup atomic across processes so a due item is posted to TikTok exactly once, no matter how many dashboard instances are running.

**Architecture:** Add a `claimed_at` column and take ownership of a row with a single conditional `UPDATE … WHERE id = ? AND (claimed_at IS NULL OR claimed_at < cutoff)` that returns the row only to the winner. The claim helpers live in `scripts/lib/claim.ts` so they are importable and testable; `fetchNextItem()` in `render-video.ts` becomes a thin composition of them. The `status` enum and every branch that reads it are left untouched.

**Tech Stack:** TypeScript, `tsx`, `node:test`, `@supabase/supabase-js` (PostgREST), Supabase Postgres.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-26-scheduler-claim-design.md`.
- **Never overwrite `status` as a claim.** `ensureScript` (`render-video.ts:143`) and the post-only short-circuit (`render-video.ts:843`) both branch on `item.status`.
- `CLAIM_TTL_MS = 30 * 60 * 1000` — the only recovery path for a crashed run. No explicit claim release anywhere.
- **`scripts/render-video.ts` calls `main()` at module scope (last lines).** Importing it runs the pipeline and posts to TikTok. No test may import it. This is why the logic goes in `scripts/lib/`.
- Migrations are applied **by hand in the Supabase SQL editor** (`docs/developer-guide.md:42`), not by a CLI. A migration task is not done until it has been run there.
- `npm test` runs `node --import tsx --test scripts/lib/__tests__/*.test.ts` and loads **no** `.env`. Tests needing credentials must skip when they are absent, and are run explicitly with `--env-file=.env`.
- The deployment (`https://dashboard.huybuilds.app`) posts for real client TikTok accounts. Verify against a dummy row, never a real client item.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migration-v7-claim.sql` | Create: the `claimed_at` column and the reworked pickup index |
| `scripts/lib/claim.ts` | Create: `CLAIM_TTL_MS`, `staleCutoff`, `claimableFilter`, `selectNextCandidate`, `claimItem` — every DB touch involved in taking ownership |
| `scripts/lib/__tests__/claim.test.ts` | Create: pure tests for the cutoff/filter builders, plus the concurrency test that proves atomicity |
| `scripts/render-video.ts` | Modify: `fetchNextItem()` (lines 110–139) composes the two lib functions |
| `docs/developer-guide.md` | Modify: migration table gains row 8 |
| `CLAUDE.md` | Modify: scheduling section documents the claim |

---

### Task 1: Add the `claimed_at` column

**Files:**
- Create: `supabase/migration-v7-claim.sql`
- Modify: `docs/developer-guide.md` (migration table, around line 46)

**Interfaces:**
- Consumes: nothing.
- Produces: a `claimed_at TIMESTAMPTZ` column (nullable, no default) on `tiktok_content_pool`. Every later task depends on it existing.

- [ ] **Step 1: Verify the column does NOT exist yet (the failing check)**

```bash
cd ~/repos/auto-tiktok-engine
KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env | cut -d= -f2-)
URL=$(grep '^SUPABASE_URL=' .env | cut -d= -f2-)
curl -s "$URL/rest/v1/tiktok_content_pool?select=id,claimed_at&limit=1" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
```

Expected: a PostgREST error mentioning `claimed_at does not exist` (code `42703`).

- [ ] **Step 2: Write the migration**

Create `supabase/migration-v7-claim.sql`:

```sql
-- Migration v7: cross-process claim for the scheduler.
--
-- pipelineRunning (dashboard/server.ts) is an in-process flag, so two running
-- instances both select the same due row and both post it. claimed_at makes
-- pickup atomic: a conditional UPDATE that only one instance can win.
--
-- Deliberately NOT a new status value — ensureScript and the post-only
-- short-circuit in render-video.ts both branch on status, and overwriting it
-- would break them.

ALTER TABLE tiktok_content_pool ADD COLUMN claimed_at TIMESTAMPTZ;

COMMENT ON COLUMN tiktok_content_pool.claimed_at IS
  'When a pipeline run took ownership. NULL = unclaimed. A claim older than '
  'CLAIM_TTL_MS (30 min, scripts/lib/claim.ts) is treated as abandoned by a '
  'crashed run and may be re-claimed. Never released explicitly.';

-- The scheduler now filters on claimed_at too, so it joins the covering index.
DROP INDEX IF EXISTS idx_content_pool_status_scheduled;
CREATE INDEX idx_content_pool_status_scheduled
  ON tiktok_content_pool (status, scheduled_for, claimed_at)
  WHERE status IN ('queued', 'scripted', 'rendered');
```

- [ ] **Step 3: Apply it**

Open the Supabase SQL editor for the linked project and run the file's contents. There is no CLI path in this repo — `docs/developer-guide.md:42` documents the SQL-editor workflow.

- [ ] **Step 4: Re-run the check to verify it now passes**

Run the same `curl` from Step 1.
Expected: HTTP 200 and a JSON array; each row has a `claimed_at` key (value `null`).

- [ ] **Step 5: Document the migration**

In `docs/developer-guide.md`, add a row to the migration table (after the `migration-v6` rows):

```markdown
| 8 | `supabase/migration-v7-claim.sql` | `claimed_at` column + reworked pickup index, for cross-process scheduler claims |
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migration-v7-claim.sql docs/developer-guide.md
git commit -m "feat(db): add claimed_at for cross-process scheduler claims"
```

---

### Task 2: The claim helpers

**Files:**
- Create: `scripts/lib/claim.ts`
- Create: `scripts/lib/__tests__/claim.test.ts`

**Interfaces:**
- Consumes: the `claimed_at` column from Task 1.
- Produces:
  - `CLAIM_TTL_MS: number`
  - `staleCutoff(now?: number): string`
  - `claimableFilter(cutoff: string): string`
  - `selectNextCandidate(supabase: SupabaseClient, cutoff: string): Promise<{ id: string } | null>`
  - `claimItem<T>(supabase: SupabaseClient, id: string, cutoff: string): Promise<T | null>`

- [ ] **Step 1: Write the failing tests**

Create `scripts/lib/__tests__/claim.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLAIM_TTL_MS, staleCutoff, claimableFilter } from '../claim';

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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/repos/auto-tiktok-engine && npx tsx --test scripts/lib/__tests__/claim.test.ts`
Expected: FAIL — cannot find module `../claim`.

- [ ] **Step 3: Write the implementation**

Create `scripts/lib/claim.ts`:

```ts
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
 * Postgres row-locks it and exactly one caller can win; the loser gets null
 * because the WHERE no longer matches.
 *
 * Never released: 'posted' and 'failed' both fall outside the pickup filter,
 * so a stale claim on a finished row is invisible.
 */
export async function claimItem<T>(
  supabase: SupabaseClient,
  id: string,
  cutoff: string,
): Promise<T | null> {
  const { data, error } = await supabase
    .from('tiktok_content_pool')
    .update({ claimed_at: new Date().toISOString() })
    .eq('id', id)
    .or(claimableFilter(cutoff))
    .select()
    .single();

  if (error?.code === 'PGRST116') return null; // another instance won
  if (error) throw new Error(`Failed to claim item: ${error.message}`);
  return data as T;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/repos/auto-tiktok-engine && npx tsx --test scripts/lib/__tests__/claim.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Verify the whole suite still passes**

Run: `cd ~/repos/auto-tiktok-engine && npm test`
Expected: PASS, including the new file (the `scripts/lib/__tests__/*.test.ts` glob picks it up automatically).

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/claim.ts scripts/lib/__tests__/claim.test.ts
git commit -m "feat: add claim helpers for atomic content-pool pickup"
```

---

### Task 3: Prove the claim is atomic

The previous task's tests cover the string builders. They cannot prove the thing that matters — that two processes racing for one row produce one winner. That is a database property, so this test hits real Supabase.

**Files:**
- Modify: `scripts/lib/__tests__/claim.test.ts` (append)

**Interfaces:**
- Consumes: `claimItem`, `staleCutoff` from Task 2; the `claimed_at` column from Task 1.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Append to `scripts/lib/__tests__/claim.test.ts`:

```ts
import { createClient } from '@supabase/supabase-js';
import { claimItem, selectNextCandidate } from '../claim';

// npm test loads no .env, so this skips by default and runs explicitly with:
//   node --env-file=.env --import tsx --test scripts/lib/__tests__/claim.test.ts
const LIVE = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

test('two concurrent claims produce exactly one winner', { skip: !LIVE }, async () => {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // A due, unclaimed dummy item. content_type is NOT NULL with no default.
  // No video_url, so even if something posted it there is nothing to upload.
  const { data: row, error: insertError } = await supabase
    .from('tiktok_content_pool')
    .insert({
      content_type: 'external',
      status: 'rendered',
      scheduled_for: new Date(Date.now() - 60_000).toISOString(),
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

    // And a claimed row is no longer a candidate for the next tick.
    const next = await selectNextCandidate(supabase, cutoff);
    assert.notEqual(next?.id, row.id, 'a claimed row must not be re-selected');
  } finally {
    await supabase.from('tiktok_content_pool').delete().eq('id', row.id);
  }
});
```

- [ ] **Step 2: Run it to verify it skips without credentials**

Run: `cd ~/repos/auto-tiktok-engine && npm test`
Expected: PASS with the concurrency test reported as skipped. This is the state CI and a fresh clone must stay in.

- [ ] **Step 3: Run it for real**

Run: `cd ~/repos/auto-tiktok-engine && node --env-file=.env --import tsx --test scripts/lib/__tests__/claim.test.ts`
Expected: PASS, 5 tests, none skipped.

If `winners.length` is 2, the claim is not atomic — most likely `.or()` was dropped from the UPDATE, or the `claimed_at` column is missing so the filter matched everything. Do not proceed to Task 4.

- [ ] **Step 4: Confirm no dummy row survived**

```bash
cd ~/repos/auto-tiktok-engine
KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env | cut -d= -f2-)
URL=$(grep '^SUPABASE_URL=' .env | cut -d= -f2-)
curl -s "$URL/rest/v1/tiktok_content_pool?hook_text=eq.CLAIM%20TEST%20%E2%80%94%20safe%20to%20delete&select=id" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
```

Expected: `[]`. If not, delete the rows — a due `external` row with no `video_url` would make the scheduler log a failure every minute.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/__tests__/claim.test.ts
git commit -m "test: prove concurrent claims produce one winner"
```

---

### Task 4: Wire the claim into the pipeline

**Files:**
- Modify: `scripts/render-video.ts` (imports, and `fetchNextItem` at lines 110–139)
- Modify: `CLAUDE.md` (the scheduling paragraph, around line 92)

**Interfaces:**
- Consumes: `staleCutoff`, `selectNextCandidate`, `claimItem` from Task 2.
- Produces: `fetchNextItem` returns `null` both when nothing is due and when another instance won the race. Callers already handle `null`.

- [ ] **Step 1: Add the import**

In `scripts/render-video.ts`, beside the existing `./lib/…` imports (near line 37, `import { uploadVideoTus } from './lib/video-upload';`):

```ts
import { staleCutoff, selectNextCandidate, claimItem } from './lib/claim';
```

- [ ] **Step 2: Replace `fetchNextItem`**

Replace the whole function (lines 110–139) with:

```ts
// --- Step 1: Fetch and claim the next content item ---
// Claiming is what stops two running instances (the deployment and a local
// dashboard) from both picking up the same due row and posting it twice —
// pipelineRunning only guards one process against itself.
async function fetchNextItem(specificId?: string): Promise<ContentRow | null> {
  const cutoff = staleCutoff();

  if (specificId) {
    // A by-id run claims too: a manual "post this now" must not collide with
    // the cron picking up the same item.
    const claimed = await claimItem<ContentRow>(supabase, specificId, cutoff);
    if (!claimed) {
      console.log('  Item is claimed by another run — skipping.');
      return null;
    }
    return claimed;
  }

  const candidate = await selectNextCandidate(supabase, cutoff);
  if (!candidate) return null;

  const claimed = await claimItem<ContentRow>(supabase, candidate.id, cutoff);
  if (!claimed) {
    // Another instance got there first. The poller runs every minute, so the
    // next tick picks up whatever is next — no retry loop needed here.
    console.log('  Item was claimed by another run — skipping this tick.');
    return null;
  }
  return claimed;
}
```

- [ ] **Step 3: Verify it type-checks**

Run: `cd ~/repos/auto-tiktok-engine && npx tsc --noEmit`
Expected: no errors from `render-video.ts` or `lib/claim.ts`.

- [ ] **Step 4: Verify a dry run still finds and processes an item**

```bash
cd ~/repos/auto-tiktok-engine && npm run pipeline:dry
```

Expected: either `No content items in queue.` (nothing due — fine) or a `Found: …` line followed by the normal dry-run output. A `Failed to claim item:` error means the migration did not apply.

- [ ] **Step 5: Verify the claim actually landed**

```bash
cd ~/repos/auto-tiktok-engine
KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env | cut -d= -f2-)
URL=$(grep '^SUPABASE_URL=' .env | cut -d= -f2-)
curl -s "$URL/rest/v1/tiktok_content_pool?claimed_at=not.is.null&select=id,status,claimed_at" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
```

Expected: if Step 4 found an item, that row now has a `claimed_at` timestamp. If Step 4 found nothing, `[]` is correct.

- [ ] **Step 6: Document the behaviour**

In `CLAUDE.md`, in the scheduling paragraph (around line 92), after the sentence describing the per-minute poll, add:

```markdown
Pickup is claimed, not just selected: `fetchNextItem` takes ownership with a conditional `UPDATE … SET claimed_at` (`scripts/lib/claim.ts`) that only one caller can win, so two running instances — the deployment and a local `npm run dashboard` — cannot both post the same item. A claim older than 30 minutes is treated as abandoned by a crashed run and becomes re-claimable; claims are never released explicitly, because `posted` and `failed` already fall outside the pickup filter.
```

- [ ] **Step 7: Run the full suite**

Run: `cd ~/repos/auto-tiktok-engine && npm test`
Expected: PASS (concurrency test skipped).

- [ ] **Step 8: Commit**

```bash
git add scripts/render-video.ts CLAUDE.md
git commit -m "fix: claim pool items before processing them

Two dashboard instances polling the same Supabase both selected the same
due row and both posted it. fetchNextItem now claims via a conditional
UPDATE; the loser skips the tick."
```

---

### Task 5: Verify against two live instances

The unit and concurrency tests prove the claim primitive. This proves the deployed system behaves, which is the thing that was actually broken.

**Files:** none — verification only.

**Interfaces:**
- Consumes: everything above, deployed.

- [ ] **Step 1: Deploy**

Push to the branch Coolify builds and wait for the deployment to go healthy. Confirm the running instance picked up the new code:

```bash
cd ~/repos/auto-tiktok-engine
curl -s -u "admin:$(grep '^DASHBOARD_PASS=' .env | cut -d= -f2-)" \
  https://dashboard.huybuilds.app/api/scheduler/status
```

Expected: HTTP 200 with the scheduler's state. A `401` means the credentials
are wrong, not that the deploy failed.

- [ ] **Step 2: Queue a dummy due item**

In the dashboard's Add Content → 🎬 Video tab, upload a short test MP4 against the **`default`** account (never a client account), scheduled two minutes out.

- [ ] **Step 3: Start a second instance locally, scheduler on**

```bash
cd ~/repos/auto-tiktok-engine && SCHEDULE_ENABLED=true npm run dashboard
```

Both instances now poll the same pool — the exact condition that used to double-post.

- [ ] **Step 4: Watch which one wins**

Expected: exactly one instance logs `[scheduler] Poll: posting next due item`. The other logs `Item was claimed by another run — skipping this tick.` Confirm on TikTok that the video appears **once** (or one inbox draft, if the account lacks the `video.publish` scope).

- [ ] **Step 5: Stop the local instance and restore its default**

Ctrl-C the local dashboard. Leave `SCHEDULE_ENABLED` unset locally so a stray local run cannot post; the deployment stays the posting host.

- [ ] **Step 6: Record the result**

Append to `docs/superpowers/specs/2026-07-26-scheduler-claim-design.md` under a new `## Verified` heading: the date, that two instances ran concurrently against one due item, and that it posted once.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/specs/2026-07-26-scheduler-claim-design.md
git commit -m "docs: record two-instance claim verification"
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| Schema — `claimed_at` + reworked index | Task 1 |
| Claim in `fetchNextItem` — candidate filter + conditional UPDATE | Tasks 2, 4 |
| Both entry points claim (by-id and poller) | Task 4, Step 2 |
| Lost race returns `null`, no retry loop | Task 4, Step 2 |
| `CLAIM_TTL_MS` = 30 min, no explicit release | Task 2, Step 3 |
| Rejected alternative (status overwrite) | Global Constraints |
| Concurrency test, skips without credentials | Task 3 |
| Manual two-dashboard verification | Task 5 |
| Fails-closed risk → watch the pool after deploy | Task 4 Step 5, Task 5 Step 4 |

**Deviation from the spec, deliberate:** the spec put the claim inline in `fetchNextItem`. It is in `scripts/lib/claim.ts` instead, because `render-video.ts` calls `main()` at module scope — a test importing it would run the pipeline and post to TikTok. The lib split is what makes Task 3 possible at all.

**Types:** `staleCutoff(now?: number): string`, `claimableFilter(cutoff: string): string`, `selectNextCandidate(supabase, cutoff): Promise<{id: string} | null>`, `claimItem<T>(supabase, id, cutoff): Promise<T | null>` — used consistently in Tasks 2, 3 and 4. `claimItem` is generic to avoid importing `ContentRow` from `render-video.ts` (which would re-introduce the module-scope `main()` hazard).
