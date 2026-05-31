# Per-item date + time scheduling — design

**Date:** 2026-05-31
**Status:** Approved (pending spec review)

## Problem

Scheduled videos can only be given a target **date** (`scheduled_for DATE`). The
actual posting *time* comes from a single global cron (`SCHEDULE_CRON`), so every
scheduled video posts at the same time of day, and only one posts per cron tick.
There is no way to say "post this video at 9:00 AM and that one at 6:00 PM."

This caused a real incident: a video scheduled for a Sunday never posted because
the global cron excluded Sunday and only handled `queued`/`scripted` items. That
bug is already fixed (the scheduler now handles `rendered` items, runs daily, and
catches up on startup). This spec adds genuine per-item date+time control on top.

## Goals

- Each content item can be scheduled for a specific **date and time**.
- An item posts at its own time, not a shared global time.
- Multiple items can be scheduled for the same day at different times.
- Missed posts (process down at the target time) still go out via startup catch-up.

## Non-goals

- Per-item timezone selection. All times are interpreted in the server/laptop
  local timezone (PDT today).
- Recurring schedules (every Monday, etc.).
- Posting more than one item simultaneously — the pipeline runs one item at a
  time; same-time items drain on consecutive poller ticks.

## Decisions (from brainstorming)

| Decision | Choice |
|----------|--------|
| Timezone semantics | Browser/laptop **local time** (PDT). No `TZ` config. |
| Default time for date-only / migration | **6:00 AM** (preserves prior cron behavior). |
| Legacy global scheduler controls | **Replace** day/time pickers with a per-minute poller; **keep** the master enable/disable toggle. |
| Storage | Single `TIMESTAMPTZ` column (not DATE + separate TIME). |
| Poll mechanism | node-cron `* * * * *` (every minute). |

## Architecture

### 1. Data model — `supabase/migration-v5-schedule-datetime.sql`

Change `scheduled_for` from `DATE` to `TIMESTAMPTZ`, converting existing dates to
6:00 AM Pacific:

```sql
ALTER TABLE tiktok_content_pool
  ALTER COLUMN scheduled_for TYPE TIMESTAMPTZ
  USING (scheduled_for + TIME '06:00' AT TIME ZONE 'America/Los_Angeles');
```

- Existing date-only rows → 06:00 PT on that date (correct absolute instant).
- The `(status, scheduled_for)` partial index rebuilds automatically.
- Update the (currently unused) `next_content_item` view: `CURRENT_DATE` → `now()`.
- Guard the migration so re-running is a no-op (check `data_type` before altering).

### 2. Scheduler → poller — `dashboard/server.ts`

Replace the fixed-time cron with a per-minute poll:

- `cron.schedule('* * * * *', () => runScheduledPipeline('Poll'))`.
- `runScheduledPipeline()` (already extracted): if `schedulerEnabled` and not
  `pipelineRunning`, and a due item exists, run the pipeline (posts one item,
  oldest due first).
- `hasScheduledItems()`: compare `scheduled_for` against the current **instant**
  (`new Date().toISOString()`), not today's date string.
- **Keep:** `SCHEDULE_ENABLED`, `/api/scheduler/toggle`, the startup catch-up call.
- **Remove:** `SCHEDULE_CRON` usage and cron validation. `/api/scheduler/settings`
  keeps its `enabled` handling but **drops** `cronExpression` (ignored if sent);
  `scheduleCron` is no longer a tunable. `/api/scheduler/toggle` is unchanged.
- `getNextRun()` / `/api/scheduler/status`: return the **earliest upcoming
  `scheduled_for`** (next actual post) instead of a cron-derived time. Query the
  soonest future scheduled item among `queued`/`scripted`/`rendered`.

### 3. Pipeline — `scripts/render-video.ts`

No logic change. `fetchNextItem()` already filters
`scheduled_for.is.null,scheduled_for.lte.now()` and orders by `scheduled_for ASC`,
which works at minute precision with `TIMESTAMPTZ`. The `rendered`-status handling
from the prior fix stays.

### 4. Dashboard UI — `dashboard/index.html`

- **Editor input:** `type="date"` → `type="datetime-local"`.
  - Save: `new Date(localValue).toISOString()` → PATCH `scheduled_for`.
  - Load: format stored ISO back into `YYYY-MM-DDTHH:mm` local for the input.
- **Date grouping / `formatDate`:** parse the full timestamp and bucket by the
  **local** calendar date. Current code does `str.split('-')` assuming
  `"YYYY-MM-DD"`; that breaks on a timestamp and must be replaced with real Date
  parsing.
- **Display:** show date **and** time on schedule cards / rows.
- **Drag-to-reschedule onto a day slot:** preserve the item's existing
  time-of-day; default to 6:00 AM if it had none.
- **SchedulerSettings panel:** remove the global day/time pickers; keep the
  enable/disable toggle and a "next post" readout.

## Timezone handling

All instants are interpreted in the **client browser / server local timezone**
(PDT). `datetime-local` yields a tz-naive local string; `new Date(value)` parses
it as local and `.toISOString()` produces the correct UTC instant. Postgres stores
UTC (`TIMESTAMPTZ`) and compares against `now()` (UTC). Because the dashboard and
pipeline run on the same laptop and the user accesses the dashboard from devices in
the same physical timezone, no explicit `TZ` configuration is required. If hosting
ever moves to a different timezone, set `TZ=America/Los_Angeles` on the server (out
of scope here).

## Error handling / edge cases

- **Date-only intent:** the UI always submits a time; if a user clears the time,
  default to 06:00 local before saving.
- **Past times:** an item with `scheduled_for` in the past is immediately "due" and
  posts on the next poll / startup catch-up (same as today's overdue behavior).
- **Concurrent due items:** the `pipelineRunning` lock serializes posting; the
  poller skips while a run is in progress and picks up the next due item on a later
  tick.
- **Invalid/empty datetime:** treat as unscheduled (`scheduled_for = null`), which
  the poller ignores.

## Testing

- **Unit (`node:test`, pure functions):**
  - local-datetime string ↔ ISO conversion round-trips correctly.
  - "is due" predicate: future instant → not due, past/now → due.
- **Behavioral:** against the live DB, confirm a future-dated item is not selected
  by the poller's query and a past-dated one is (mirroring the verification done
  for the prior scheduler fix).
- `tsc --noEmit` clean; existing `npm test` suite stays green.

## Rollout

1. Apply `migration-v5-schedule-datetime.sql` in Supabase.
2. Deploy the updated `server.ts` + `index.html`.
3. Restart the dashboard (poller starts; startup catch-up runs once).
