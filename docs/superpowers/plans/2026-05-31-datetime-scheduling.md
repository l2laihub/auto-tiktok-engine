# Per-item Date + Time Scheduling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each content item be scheduled for a specific date **and** time, posting at its own time instead of a single global cron time.

**Architecture:** `scheduled_for` becomes `TIMESTAMPTZ` (was `DATE`). A per-minute poller replaces the fixed-time cron and posts any item whose `scheduled_for <= now()`. The dashboard uses `datetime-local` inputs; all local↔ISO conversion lives in one shared, unit-tested helper module. All times are interpreted in the runtime's local timezone (PDT).

**Tech Stack:** Supabase Postgres, Express + node-cron (`dashboard/server.ts`), inline React+htm dashboard (`dashboard/index.html`), `node:test` via tsx.

---

## File Structure

- **Create** `supabase/migration-v5-schedule-datetime.sql` — DATE→TIMESTAMPTZ migration; drop/recreate dependent view.
- **Create** `public/schedule-time.js` — plain ESM helpers (served to browser at `/static/schedule-time.js`, imported by tests). Single source of truth for local↔ISO conversion.
- **Create** `scripts/lib/__tests__/schedule-time.test.ts` — unit tests for the helpers (TZ pinned).
- **Modify** `dashboard/server.ts` — per-minute poller; `hasScheduledItems` instant compare; `getNextRun` → earliest upcoming item; strip cron tunable from `/api/scheduler/settings` + `/api/scheduler/status`.
- **Modify** `dashboard/index.html` — import helpers; `datetime-local` inputs; date-bucketing by local day; display date+time; drag preserves time; remove global day/time picker (keep enable toggle + next-post readout).

Note: `scripts/render-video.ts` needs **no** change — `fetchNextItem()` already filters `scheduled_for.lte.now()` and works at timestamp precision.

---

## Task 1: Database migration (DATE → TIMESTAMPTZ)

**Files:**
- Create: `supabase/migration-v5-schedule-datetime.sql`

- [ ] **Step 1: Write the migration**

The `next_content_to_process` view references `scheduled_for`, so Postgres will block the `ALTER`. Drop it first, alter, then recreate it using `now()`. Existing dates convert to 6:00 AM Pacific. Guard the `ALTER` so re-running is a no-op.

```sql
-- migration-v5-schedule-datetime.sql
-- Per-item date+time scheduling: scheduled_for DATE -> TIMESTAMPTZ.
-- Existing date-only rows become 06:00 America/Los_Angeles on that date.

-- 1. The helper view depends on scheduled_for; drop it before altering the type.
DROP VIEW IF EXISTS next_content_to_process;

-- 2. Change the column type (idempotent: only runs while still a DATE).
DO $$
BEGIN
  IF (
    SELECT data_type FROM information_schema.columns
    WHERE table_name = 'tiktok_content_pool' AND column_name = 'scheduled_for'
  ) = 'date' THEN
    ALTER TABLE tiktok_content_pool
      ALTER COLUMN scheduled_for TYPE TIMESTAMPTZ
      USING (scheduled_for + TIME '06:00' AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- 3. Recreate the view, comparing against the current instant instead of date.
CREATE VIEW next_content_to_process AS
  SELECT *
  FROM tiktok_content_pool
  WHERE status = 'queued'
    AND (scheduled_for IS NULL OR scheduled_for <= now())
  ORDER BY scheduled_for ASC NULLS LAST, created_at ASC
  LIMIT 1;
```

- [ ] **Step 2: Apply the migration**

Run it in the Supabase SQL editor (or `supabase db push`), then verify the column type:

```sql
SELECT data_type FROM information_schema.columns
WHERE table_name = 'tiktok_content_pool' AND column_name = 'scheduled_for';
-- Expected: timestamp with time zone
```

- [ ] **Step 3: Verify existing rows converted correctly**

```sql
SELECT id, scheduled_for FROM tiktok_content_pool
WHERE scheduled_for IS NOT NULL ORDER BY scheduled_for LIMIT 5;
-- Expected: timestamps at 13:00:00+00 (= 06:00 PDT) on the original dates.
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migration-v5-schedule-datetime.sql
git commit -m "feat(db): migrate scheduled_for to TIMESTAMPTZ (migration-v5)"
```

---

## Task 2: Shared local↔ISO helper module (TDD)

**Files:**
- Create: `public/schedule-time.js`
- Test: `scripts/lib/__tests__/schedule-time.test.ts`

- [ ] **Step 1: Write the failing test**

The test pins `TZ` so local-time math is deterministic regardless of where it runs. `TZ` must be set before anything reads the clock; set it at the top of the file.

```ts
// scripts/lib/__tests__/schedule-time.test.ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../../../public/schedule-time.js'`.

- [ ] **Step 3: Implement the helper module**

```js
// public/schedule-time.js
// Local-timezone scheduling helpers, shared by the dashboard UI (served at
// /static/schedule-time.js) and unit tests. Every conversion uses the runtime's
// LOCAL timezone, which is the source of truth for scheduling. Plain ESM (no
// build step) so the browser and node/tsx can both import the same file.

const pad = (n) => String(n).padStart(2, '0');

const valid = (d) => d instanceof Date && !Number.isNaN(d.getTime());

// ISO string -> "YYYY-MM-DDTHH:mm" for <input type="datetime-local"> (local tz).
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (!valid(d)) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// "YYYY-MM-DDTHH:mm" (parsed as LOCAL time) -> UTC ISO string. Empty -> null.
export function fromLocalInput(local) {
  if (!local) return null;
  const d = new Date(local);
  if (!valid(d)) return null;
  return d.toISOString();
}

// ISO string (or Date) -> "YYYY-MM-DD" key for the item's LOCAL calendar date.
export function localDateKey(iso) {
  if (!iso) return '';
  const d = iso instanceof Date ? iso : new Date(iso);
  if (!valid(d)) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ISO string -> "May 31, 9:00 AM" local label.
export function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (!valid(d)) return '';
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

// "YYYY-MM-DD" + optional source instant -> UTC ISO. Preserves the source's
// local time-of-day when given (used when dragging to a new day); otherwise
// defaults to 06:00 local.
export function dayKeyToISO(dateKey, timeFromIso) {
  if (!dateKey) return null;
  let hh = 6, mm = 0;
  if (timeFromIso) {
    const t = new Date(timeFromIso);
    if (valid(t)) { hh = t.getHours(); mm = t.getMinutes(); }
  }
  const d = new Date(`${dateKey}T${pad(hh)}:${pad(mm)}`);
  return valid(d) ? d.toISOString() : null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all `schedule-time` tests green, existing suite still green.

- [ ] **Step 5: Commit**

```bash
git add public/schedule-time.js scripts/lib/__tests__/schedule-time.test.ts
git commit -m "feat(dashboard): add shared local<->ISO schedule-time helpers + tests"
```

---

## Task 3: Server — per-minute poller, instant comparison, next-run query

**Files:**
- Modify: `dashboard/server.ts` (scheduler section, ~lines 985–1135)

- [ ] **Step 1: Replace the global-cron state + `hasScheduledItems` with a per-minute poller**

Find the block beginning `let scheduleCron = process.env.SCHEDULE_CRON ...` and ending at the close of `startScheduler()`. Replace the `scheduleCron` declaration, `hasScheduledItems`, and `startScheduler` so the cron is a fixed every-minute poll and the due-check compares the current instant. Keep `schedulerEnabled`, `schedulerTask`, and `runScheduledPipeline` (only its log string changes).

```ts
let schedulerEnabled = process.env.SCHEDULE_ENABLED !== 'false';
let schedulerTask: ReturnType<typeof cron.schedule> | null = null;

// True if any item is due to post now (scheduled_for at or before this instant).
// 'rendered' is included so a pre-rendered item that is now due still counts.
async function hasScheduledItems(): Promise<boolean> {
  const { count } = await supabase
    .from('tiktok_content_pool')
    .select('id', { count: 'exact', head: true })
    .in('status', ['queued', 'scripted', 'rendered'])
    .lte('scheduled_for', new Date().toISOString());

  return (count ?? 0) > 0;
}

// Shared by the poller tick and the startup catch-up: post the next due item if
// one exists and nothing is already running. `trigger` is only for logging.
async function runScheduledPipeline(trigger: string): Promise<void> {
  if (!schedulerEnabled) return;

  if (pipelineRunning) return; // quiet: this runs every minute

  const hasItems = await hasScheduledItems();
  if (!hasItems) return;

  console.log(`[scheduler] ${trigger}: posting next due item at ${new Date().toLocaleString()}`);
  const runId = await runPipeline({ dryRun: false });
  console.log(`[scheduler] Pipeline started (runId: ${runId})`);
}

function startScheduler() {
  if (schedulerTask) schedulerTask.stop();
  // Poll every minute and post whatever is due. Per-item scheduled_for
  // timestamps decide when something posts — there is no global post time.
  schedulerTask = cron.schedule('* * * * *', () => runScheduledPipeline('Poll'));
  console.log(`Scheduler started: per-minute poll (${schedulerEnabled ? 'enabled' : 'disabled'})`);
}
```

> Note: the existing `runScheduledPipeline` is being merged into this block — ensure only ONE definition remains. The startup catch-up call `await runScheduledPipeline('Startup catch-up')` in `app.listen` stays as-is.

- [ ] **Step 2: Replace `getNextRun()` with the earliest upcoming scheduled item**

Find `function getNextRun()` (currently parses the cron expression). Replace it with an async query for the soonest future `scheduled_for`:

```ts
// The next actual post: the soonest future scheduled_for among postable items.
async function getNextRun(): Promise<string | null> {
  if (!schedulerEnabled) return null;
  const { data } = await supabase
    .from('tiktok_content_pool')
    .select('scheduled_for')
    .in('status', ['queued', 'scripted', 'rendered'])
    .gt('scheduled_for', new Date().toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.scheduled_for ?? null;
}
```

- [ ] **Step 3: Update `/api/scheduler/status` and `/api/scheduler/settings`**

`getNextRun()` is now async and there is no cron string. Find `app.get('/api/scheduler/status'...)` and `app.patch('/api/scheduler/settings'...)` and update them:

```ts
app.get('/api/scheduler/status', async (_req, res) => {
  res.json({
    enabled: schedulerEnabled,
    nextRun: await getNextRun(),
    pipelineRunning,
  });
});

app.patch('/api/scheduler/settings', async (req, res) => {
  const { enabled } = req.body;
  if (enabled !== undefined) {
    schedulerEnabled = Boolean(enabled);
    console.log(`[scheduler] ${schedulerEnabled ? 'Enabled' : 'Disabled'}`);
  }
  startScheduler();
  res.json({ enabled: schedulerEnabled, nextRun: await getNextRun() });
});
```

> If `/api/scheduler/toggle` exists and already flips `schedulerEnabled`, leave it unchanged. Remove any remaining references to `scheduleCron` and `cron.validate` (search the file to confirm none remain).

- [ ] **Step 4: Verify the server compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0, no errors. (Fix any lingering `scheduleCron`/`getNextRun` call sites — e.g. `await getNextRun()` everywhere it's used.)

- [ ] **Step 5: Commit**

```bash
git add dashboard/server.ts
git commit -m "feat(dashboard): per-minute scheduler poll + next-run query (no global cron)"
```

---

## Task 4: Dashboard — import helpers, list-view editor + display

**Files:**
- Modify: `dashboard/index.html` (module imports ~line 1864; `formatDate` ~2336; inline editor ~2390–2405; list display ~2450)

- [ ] **Step 1: Import the shared helpers**

After the existing `import htm from ...` line (~1864), add:

```js
import { toLocalInput, fromLocalInput, localDateKey, formatDateTime, dayKeyToISO } from '/static/schedule-time.js';
```

- [ ] **Step 2: Replace `formatDate` usage with `formatDateTime`**

The current `formatDate(d)` splits a `"YYYY-MM-DD"` string and breaks on a timestamp. Replace the `formatDate` function body so it delegates to the shared helper (keep the name to avoid touching every call site):

```js
function formatDate(d) {
  return formatDateTime(d);
}
```

- [ ] **Step 3: Convert the inline list editor to `datetime-local`**

At the inline editor (~2395), change the input type and wire conversion. Replace the `type="date"` input and its save handler so the value is a local datetime and the PATCH stores ISO:

```js
// input (~2395):
type="datetime-local"
value=${toLocalInput(item.scheduled_for)}
onChange=${async (e) => {
  const iso = fromLocalInput(e.target.value);
  await api('/api/content/' + item.id, { method: 'PATCH', body: { scheduled_for: iso } });
  // ...keep existing post-save refresh/toast logic...
}}
```

> Locate the existing save handler near line 2345 (`PATCH ... body: { scheduled_for: newDate || null }`) and update it to send `fromLocalInput(newDate)` instead of `newDate || null`.

- [ ] **Step 4: Verify in the browser**

Run: `npm run dashboard`, open the list view. Confirm the schedule cell shows date **and** time (e.g. "May 31, 6:00 AM"), editing opens a datetime picker, and saving persists the chosen time (reload to confirm).

- [ ] **Step 5: Commit**

```bash
git add dashboard/index.html
git commit -m "feat(dashboard): datetime-local editor + date/time display in list view"
```

---

## Task 5: Dashboard — schedule grid grouping, drag, mobile reschedule

**Files:**
- Modify: `dashboard/index.html` (grid `itemsForDay` ~2685; drag handler ~2693; mobile reschedule ~2744–2755)

- [ ] **Step 1: Bucket items into day columns by local date**

The grid currently matches `i.scheduled_for === ds` (exact `"YYYY-MM-DD"`), which never matches a timestamp. Update `itemsForDay` (~2685) to compare the item's local date key:

```js
function itemsForDay(d) {
  const ds = dateStr(d);
  return items.filter(i => localDateKey(i.scheduled_for) === ds);
}
```

- [ ] **Step 2: Preserve time-of-day when dragging to a new day**

The drag handler (~2693) sets `scheduled_for: dateStr(date)` (date-only string). Update it to build an ISO that keeps the dragged item's existing time (or defaults to 06:00):

```js
const dragged = items.find(i => i.id === dragItem);
const iso = dayKeyToISO(dateStr(date), dragged?.scheduled_for);
await api('/api/content/' + dragItem, { method: 'PATCH', body: { scheduled_for: iso } });
```

- [ ] **Step 3: Convert the mobile reschedule control to `datetime-local`**

At the mobile reschedule input (~2746), change type, value, and save to use the helpers:

```js
type="datetime-local"
value=${toLocalInput(item.scheduled_for)}
onChange=${async (e) => {
  const iso = fromLocalInput(e.target.value);
  await api('/api/content/' + item.id, { method: 'PATCH', body: { scheduled_for: iso } });
  // ...keep existing refresh/close-reschedule logic...
}}
```

- [ ] **Step 4: Verify in the browser**

Run/refresh `npm run dashboard`. Confirm: items appear in the correct day column; dragging a card to another day keeps its time-of-day; the mobile reschedule control shows and saves a date+time.

- [ ] **Step 5: Commit**

```bash
git add dashboard/index.html
git commit -m "feat(dashboard): time-aware schedule grid grouping, drag, and reschedule"
```

---

## Task 6: Dashboard — create forms default to date+time

**Files:**
- Modify: `dashboard/index.html` (`getNextSlot` ~3046; create POST ~3111; reveal form input ~3232; tip form input ~3276)

- [ ] **Step 1: Default new items to tomorrow at 06:00 local**

Update `getNextSlot()` (~3046) to return a `datetime-local` string (so the form input shows it) rather than a date-only string:

```js
function getNextSlot() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(6, 0, 0, 0);
  return toLocalInput(d.toISOString());
}
```

- [ ] **Step 2: Convert both create-form inputs to `datetime-local`**

At the reveal form (~3232) and tip form (~3276), change each input:

```js
<input className="form-input" type="datetime-local" value=${form.scheduled_for} onInput=${update('scheduled_for')} />
```

- [ ] **Step 3: Convert local→ISO on create**

At the create handler (~3111) where the body is built (`scheduled_for: form.scheduled_for || null`), convert to ISO:

```js
const body = { content_type: subTab, scheduled_for: fromLocalInput(form.scheduled_for) };
```

> If there are two create paths (reveal vs tip), apply the same conversion to both.

- [ ] **Step 4: Verify in the browser**

Create a new item with a specific date+time. Confirm it saves, appears in the right day column at the chosen time, and reloads correctly.

- [ ] **Step 5: Commit**

```bash
git add dashboard/index.html
git commit -m "feat(dashboard): create forms schedule with date+time, default 6 AM"
```

---

## Task 7: Dashboard — strip global day/time picker, keep enable toggle + next-post readout

**Files:**
- Modify: `dashboard/index.html` (`DAY_CRON_MAP`/`parseCron`/`buildCron` ~2487–2503; `SchedulerSettings` ~2505–2600; grid `cronDays` highlight ~2669, 2705)

- [ ] **Step 1: Remove the cron-parsing helpers**

Delete `DAY_CRON_MAP`, `parseCron`, and `buildCron` (~2487–2503) — there is no editable cron anymore.

- [ ] **Step 2: Simplify `SchedulerSettings`**

Replace the `SchedulerSettings` component (~2505–2600) with a version that fetches status, shows the enable/disable toggle, and shows the next scheduled post. Remove the day checkboxes, time picker, and `.cron-preview`. It no longer reports active days to the parent.

```js
function SchedulerSettings({ onToast }) {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    api('/api/scheduler/status').then(setStatus).catch(() => {});
  }, []);

  async function toggle() {
    const res = await api('/api/scheduler/settings', {
      method: 'PATCH',
      body: { enabled: !status.enabled },
    });
    setStatus(s => ({ ...s, ...res }));
    onToast?.(res.enabled ? 'Auto-posting enabled' : 'Auto-posting paused');
  }

  if (!status) return null;
  const next = status.nextRun
    ? new Date(status.nextRun).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'no upcoming posts';

  return html`
    <div className="scheduler-settings">
      <div className="scheduler-settings-header">
        <span className="scheduler-settings-title">Auto-posting</span>
        <button className="btn-toggle" onClick=${toggle}>
          ${status.enabled ? 'On' : 'Off'}
        </button>
      </div>
      <div className="scheduler-next">
        <span className="scheduler-next-dot"></span>Next post: ${next}
      </div>
    </div>
  `;
}
```

- [ ] **Step 3: Remove `cronDays` highlighting from the grid**

In the schedule grid component, remove the `cronDays` state and the `onSettingsChanged` prop wiring (~2669, 2705). Render `<${SchedulerSettings} onToast=${onToast} />` without `onSettingsChanged`, and drop the `activeDays`/`cronDay` highlight logic (every day is postable now).

- [ ] **Step 4: Verify in the browser**

Confirm the scheduler panel shows only an On/Off toggle + "Next post" line, the toggle pauses/resumes auto-posting, and the grid renders without day-highlighting errors. Check the browser console for no errors.

- [ ] **Step 5: Commit**

```bash
git add dashboard/index.html
git commit -m "feat(dashboard): replace global cron picker with enable toggle + next-post readout"
```

---

## Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck + unit tests**

Run: `npx tsc --noEmit -p tsconfig.json && npm test`
Expected: tsc exit 0; all tests pass (including the new `schedule-time` tests).

- [ ] **Step 2: Behavioral check against the live DB**

Write a throwaway script (in the repo root so it resolves `@supabase/supabase-js`) that mirrors the poller's due-check, and confirm a **future**-timed item is NOT due and a **past**-timed one IS:

```ts
import { createClient } from '@supabase/supabase-js';
(async () => {
  const s = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const now = new Date().toISOString();
  const { count } = await s.from('tiktok_content_pool')
    .select('id', { count: 'exact', head: true })
    .in('status', ['queued', 'scripted', 'rendered'])
    .lte('scheduled_for', now);
  console.log('due now =', count, '(items with scheduled_for <=', now + ')');
})();
```

Run: `node --env-file=.env --import tsx <script>.ts` then delete it.
Expected: a count consistent with the items whose time has passed (future-timed items excluded).

- [ ] **Step 3: End-to-end smoke (manual)**

Schedule a test item ~2 minutes in the future, keep `npm run dashboard` running, and confirm the per-minute poller posts it within ~1 minute of its time (watch the server log for `[scheduler] Poll: posting next due item`). Use a dry/inbox-safe item if you don't want it live.

- [ ] **Step 4: Update docs**

Update `CLAUDE.md`'s scheduler description (Dashboard section / env vars) to note: `scheduled_for` is a `TIMESTAMPTZ`, auto-posting is a per-minute poll (no `SCHEDULE_CRON`), times are local. Remove the `SCHEDULE_CRON` mention from the env section.

```bash
git add CLAUDE.md
git commit -m "docs: scheduler now posts per-item date+time via per-minute poll"
```

---

## Self-Review notes

- **Spec coverage:** TIMESTAMPTZ migration (T1) ✓; datetime-local UI (T4–T6) ✓; per-minute poller + instant `hasScheduledItems` (T3) ✓; next-run = earliest upcoming (T3) ✓; remove `SCHEDULE_CRON`/day-picker, keep toggle (T3, T7) ✓; local-tz conversion (T2) ✓; date-only/migration default 06:00 (T1, T2 `dayKeyToISO`, T6) ✓; drag preserves time (T5) ✓; pipeline unchanged (noted) ✓; tests + behavioral verification (T2, T8) ✓.
- **Type/name consistency:** helper names `toLocalInput`/`fromLocalInput`/`localDateKey`/`formatDateTime`/`dayKeyToISO` are used identically across T2/T4/T5/T6. `getNextRun()` is async everywhere it's awaited (T3).
- **`SCHEDULE_ENABLED`** is retained; only `SCHEDULE_CRON` is removed.
