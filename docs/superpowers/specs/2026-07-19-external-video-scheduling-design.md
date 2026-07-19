# External Video Scheduling (studio-ops → dashboard → client TikTok accounts)

**Date:** 2026-07-19 · **Status:** Approved (Approach A)

## Goal

Schedule already-rendered MP4s (studio-ops `video-post` output in `output/`) from the
dashboard, auto-posting each at its scheduled time to a **per-client TikTok account**.

## Decisions (from brainstorming)

- Post to **client TikTok accounts** (multi-account tokens), not only @huybuilds.
- Ingestion via a **dashboard upload form** (MP4 + caption + hashtags + account + datetime).
- **Huy operates all client accounts** — existing single Telegram chat keeps receiving the
  inbox caption notifications; no per-client notification routing.

## Design — maximum reuse

An external video is a content-pool item that is *born rendered*: `status='rendered'`,
`video_url` set, `scheduled_for` set. The existing per-minute scheduler, the
`rendered`+`video_url` post-only short-circuit in `render-video.ts`, and the Telegram
inbox notifier then work unchanged.

### 1. Schema (`supabase/migration-v6-external-videos.sql`)

- `ALTER TYPE content_type ADD VALUE 'external'`
- `ALTER TABLE tiktok_content_pool ADD COLUMN tiktok_account TEXT` — NULL means the
  default (@huybuilds) account.
- **No `tiktok_tokens` change needed**: its `id TEXT PRIMARY KEY DEFAULT 'default'` is
  already the account key. Client accounts are extra rows (`id = 'nk-nails'`, …).

### 2. Token layer (`scripts/lib/tiktok-api.ts`)

`TikTokClient` gains a constructor param `account = 'default'`; the four hardcoded
`'default'` id literals become `this.account`. Same TikTok developer app (client
key/secret) serves all accounts.

### 3. OAuth setup (`scripts/tiktok-oauth-setup.ts`)

`npm run tiktok:setup -- --account nk-nails` runs the same OAuth flow but persists the
token row under that id. Prerequisite (outside this repo): the client account must be a
target user of the TikTok developer app, and consent is granted while logged into the
client's TikTok.

### 4. Pipeline (`scripts/render-video.ts`)

- `ContentRow` gains `tiktok_account?`; `content_type` union gains `'external'`.
- `postToTikTok` constructs `new TikTokClient(supabase, item.tiktok_account ?? 'default')`.
- The TUS upload helper moves to `scripts/lib/video-upload.ts` so the dashboard reuses it.

### 5. Dashboard server (`dashboard/server.ts`)

- `POST /api/external-video` — multer (disk storage, 300MB cap, field `video`) + fields
  `caption`, `hashtags`, `account`, `scheduledFor` (UTC ISO). Uploads the MP4 to the
  `videos` bucket via the shared TUS helper, then inserts
  `{content_type:'external', status:'rendered', video_url, caption, hashtags,
  tiktok_account, scheduled_for, hook_text}` (`hook_text` = first caption line, for list
  display).
- `GET /api/tiktok/accounts` — token-row ids for the form dropdown.
- Token-refresh cron iterates **all** token rows instead of only default.
- The dashboard's TikTok re-auth panel stays default-account-only; client OAuth is CLI.

### 6. Dashboard UI (`dashboard/index.html`)

Third sub-tab in Add Content: **🎬 Video** — file picker, caption textarea, hashtags
input, account select (from `/api/tiktok/accounts`), required `datetime-local`
(converted with the existing `schedule-time.js` helpers), upload-progress feedback.

## Error handling

- Upload failures reuse the TUS retry ladder; endpoint returns 4xx/5xx with message.
- Post failures at schedule time follow the existing pipeline `failed` status path.
- Missing token for an account → existing `TokenExpiredError` message names
  `npm run tiktok:setup` (now with `--account`).

## Testing

- `npm test` still passes (pure-function tests untouched).
- Manual: upload a small MP4 scheduled 2 min out with `--account` token present; verify
  inbox draft on the client account + Telegram ping.

## Out of scope

- Per-client Telegram routing, dashboard OAuth for client accounts, auto-import from
  studio-ops month files, Direct Post scope auditing.
