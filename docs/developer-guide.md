# Developer Guide — EternalFrame Auto-TikTok Engine

Deep technical reference for developers working on the pipeline. For initial setup and common commands, see README.md.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Environment Setup](#2-environment-setup)
3. [Project Structure](#3-project-structure)
4. [Pipeline Internals](#4-pipeline-internals)
5. [Script Generation](#5-script-generation)
6. [Music Generation](#6-music-generation)
7. [Video Rendering System](#7-video-rendering-system)
8. [TikTok API Integration](#8-tiktok-api-integration)
9. [Dashboard API Reference](#9-dashboard-api-reference)
10. [Extending the System](#10-extending-the-system)
11. [Debugging](#11-debugging)

---

## 1. Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | 20+ | Required for `--env-file` flag used in all npm scripts |
| ffmpeg | Any recent | Used by `downloadAndTrim()` in `src/utils/suno.ts` to trim and fade audio |
| Supabase project | — | Service role key required (NOT anon key) |
| Anthropic API key | — | For Claude script and photo analysis calls |
| TikTok developer app | Optional | Required only for auto-posting; manual upload works without it |
| Self-hosted suno-api | Optional | gcui-art/suno-api server for music generation; pipeline continues without it |

ffmpeg must be on `$PATH`. The pipeline will fail at the music generation step if `ffmpeg` is not found, but all other steps will proceed normally.

---

## 2. Environment Setup

### Database Migrations

Run migrations in order in the Supabase SQL editor:

| Order | File | Purpose |
|-------|------|---------|
| 1 | `supabase/migration.sql` | Core schema: enums, `tiktok_content_pool`, `tiktok_music_library`, views, triggers |
| 2 | `supabase/migration_002_dashboard.sql` | `pipeline_run_log` table for dashboard history |
| 3 | `supabase/migration_003_tiktok_tokens.sql` | `tiktok_tokens` table, `publish_status` column |
| 4 | `supabase/migration-v2.sql` | Multi-pair support (`image_pairs` JSONB, 1–6 pair constraint), Suno audio fields, backfill for legacy single-pair rows |

Migration 4 must run after 1–3. The backfill in `migration-v2.sql` normalizes existing single-pair rows into the `image_pairs` JSONB format so the rendering code only needs to handle one path.

### Environment Variables

**Required:**

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Supabase project URL (e.g., `https://your-project.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key — has full DB access, never expose client-side |
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude calls in script generation and photo analysis |

**Optional:**

| Variable | Description | Default |
|----------|-------------|---------|
| `SUNO_API_URL` | Self-hosted Suno API URL | Skips music generation if unset |
| `SUNO_COOKIE` | Suno session cookie for the self-hosted server | — |
| `TIKTOK_CLIENT_KEY` | TikTok app client key (OAuth) | — |
| `TIKTOK_CLIENT_SECRET` | TikTok app client secret | — |
| `TIKTOK_REDIRECT_URI` | Must match TikTok app settings | `https://www.tiktok.com/` |
| `TIKTOK_ACCESS_TOKEN` | Static fallback token (no auto-refresh) | Falls back to manual upload mode |
| `OUTPUT_DIR` | Output directory for rendered videos | `./output` |

All npm scripts use `node --env-file=.env --import tsx`. Do not use `ts-node`; it is not installed or supported.

### TikTok OAuth

Run `npm run tiktok:setup` for an interactive PKCE OAuth flow. This stores the access token and refresh token in the `tiktok_tokens` Supabase table. The `TIKTOK_ACCESS_TOKEN` env variable is a static fallback only — it does not auto-refresh. Prefer the database-stored token for production.

---

## 3. Project Structure

```
auto-tiktok-engine/
├── package.json
├── tsconfig.json                      # ES2022, ESNext, react-jsx, strict
├── .env.example
├── CLAUDE.md                          # Claude Code project instructions
├── README.md
├── TESTING.md                         # 8-stage testing guide
├── dashboard/
│   ├── server.ts                      # Express API (port 3001), 14 endpoints
│   └── index.html                     # Single-file React SPA (React 18 CDN + htm)
├── public/
│   ├── eternalframe-logo.jpg          # App logo used by EternalFrameCTA component
│   └── music/                         # Generated music files (referenced via staticFile())
├── src/
│   ├── index.ts                       # Remotion entry point: registerRoot(RemotionRoot)
│   ├── Root.tsx                       # Composition registry with calculateMetadata
│   ├── config.ts                      # Brand colors, VIDEO dims, timing functions, easing
│   ├── compositions/
│   │   ├── BeforeAfterReveal.tsx      # Multi-pair photo reveal template
│   │   └── TipsEducational.tsx        # Multi-tip educational template
│   ├── components/
│   │   ├── RevealPair.tsx             # Renders one before/transition/after sequence
│   │   ├── TipCard.tsx                # Renders one tip card
│   │   ├── HookText.tsx               # Word-by-word animated text overlay
│   │   └── EternalFrameCTA.tsx        # Branded CTA with staggered entrance
│   └── utils/
│       └── suno.ts                    # Suno AI music generation, download, trim
├── scripts/
│   ├── generate-script.ts             # Claude API script generation (importable + CLI)
│   ├── render-video.ts                # 6-step pipeline orchestrator
│   ├── tiktok-oauth-setup.ts          # Interactive PKCE OAuth flow
│   └── lib/
│       └── tiktok-api.ts              # TikTokClient: tokens, upload, polling, error types
├── supabase/
│   ├── migration.sql
│   ├── migration-v2.sql
│   ├── migration_002_dashboard.sql
│   └── migration_003_tiktok_tokens.sql
└── output/                            # Rendered videos (gitignored)
```

---

## 4. Pipeline Internals

The pipeline lives in `scripts/render-video.ts` and runs as 6 sequential steps inside `main()`.

### ContentRow Interface

Key fields on `ContentRow` (mapped from `tiktok_content_pool`):

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | UUID |
| `content_type` | `'reveal' \| 'tip'` | Selects composition |
| `status` | enum | `queued → scripted → rendering → rendered → posted \| failed` |
| `image_pairs` | JSONB `{before_url, after_url, era?, label?}[]` | Multi-pair reveal data (1–6 pairs) |
| `before_image_url`, `after_image_url`, `photo_era` | string | Legacy flat fields, normalized to `image_pairs` |
| `tip_title`, `tip_body`, `tip_source`, `tip_image_url` | string | Tip content |
| `hook_text`, `caption`, `hashtags` | string, string, string[] | AI-generated script fields |
| `music_style` | string | Suno prompt string |
| `suno_audio_url` | string | CDN URL from Suno API |
| `music_file_path` | string | Local path under `public/music/` |
| `audio_volume` | number | Volume multiplier for Remotion Audio component |
| `video_url` | string | Supabase Storage public URL post-upload |
| `slogan` | string | Short branded phrase, 3–7 words |

### Step 1 — fetchNextItem

Fetches a specific item by ID if provided as a CLI argument. Otherwise queries for the oldest `queued` or `scripted` item where `scheduled_for <= now`, ordered by `scheduled_for ASC, created_at ASC`. Returns `null` if nothing is available — the pipeline exits cleanly.

### Step 2 — ensureScript

Skips entirely if the item's status is not `'queued'` OR if `hook_text` is already populated.

On execution: calls `generateScript()` with content metadata including `pair_count` and `photo_stories`. Updates the DB row with `hook_text`, `caption`, `hashtags`, `music_style`, `slogan`, and sets `status = 'scripted'`.

### Step 3 — generateAudio

Skips if `music_file_path` already exists on disk OR if `SUNO_API_URL` is not set. When both conditions pass, it:

1. Computes target duration using `createRevealTiming(pairCount)` or `createTipsTiming(1)`.
2. Calls `generateMusicTrack()` using `music_style` as the prompt.
3. Calls `downloadAndTrim()` to produce a trimmed MP3 at `public/music/{id-prefix}.mp3`.
4. Updates the DB: `suno_audio_url`, `music_file_path`.

### Step 4 — renderVideo

Sets `status = 'rendering'`. Bundles the Remotion project via `@remotion/bundler`. Resolves the `musicFile` prop using this priority order:

1. Local `public/music/` path (for `staticFile()` in Remotion)
2. Suno CDN URL from `suno_audio_url`
3. Legacy `music_track` field

Builds `inputProps` from DB fields and calls `renderMedia()` with:
- Codec: `h264`
- Video bitrate: `8M`
- Audio bitrate: `192k`

Output file: `{OUTPUT_DIR}/{type}-{id-prefix}.mp4`. Updates `video_duration_ms` on the DB row.

### Step 5 — uploadVideo

Reads the rendered file from disk and uploads to Supabase Storage bucket `videos` at path `tiktok-videos/{filename}`. Appends a cache-bust query param to the public URL. Updates `video_url` and sets `status = 'rendered'`.

### Step 6 — postToTikTok

| Condition | Behavior |
|-----------|----------|
| `--dry-run` flag | Logs caption and hashtags; skips posting |
| No TikTok token | Logs video path for manual upload |
| Token present | Calls `TikTokClient.initVideoPublish()` |

On success: updates `tiktok_post_id`, `posted_at`, `status = 'posted'`.
On failure: updates `post_error`, `status = 'failed'`.

### CLI Flags

| Flag | Effect |
|------|--------|
| `--dry-run` | Skips step 6 (posting) |
| `--post-only` | Skips steps 2–4 (script/music/render), goes straight to upload + post |
| `{content-id}` (positional) | Pins the pipeline to a specific row |

---

## 5. Script Generation

Script generation lives in `scripts/generate-script.ts`. It is both importable (used by `render-video.ts`) and runnable as a CLI.

### Interfaces

```typescript
interface ContentItem {
  id: string;
  content_type: 'reveal' | 'tip';
  photo_era?: string;
  photo_story?: string;
  preset_used?: string;
  pair_count?: number;
  photo_stories?: string[];   // one entry per pair
  tip_title?: string;
  tip_body?: string;
  tip_source?: string;
}

interface GeneratedScript {
  hook_text: string;    // max 60 chars enforced; truncated at 80 if exceeded
  caption: string;      // 150–300 chars
  hashtags: string[];   // 5–8 tags
  music_mood: string;
  music_style: string;  // full Suno prompt string
  slogan: string;       // 3–7 words
  takeaway?: string;    // tips only
}
```

### Prompt Strategy

The system prompt enforces:
- Warm/nostalgic/personal tone — never salesy
- Target audience: adults 30–65, with Vietnamese-American segment callouts
- Hook rules: max 60 chars, lead with emotional trigger
- Caption rules: 150–300 chars, micro-story structure, soft CTA
- Hashtag rules: mix broad tags (`#photorestoration`) and niche (`#vietnamesefamily`)
- Multi-pair context: `buildUserPrompt()` includes `pairCount` and per-pair stories so Claude can write hooks like "3 forgotten photos..."
- Response must be JSON only — no markdown fences, no prose

### Model Call

Model: `claude-sonnet-4-20250514`, `max_tokens: 500`. After receiving the response, the function strips any residual markdown fences before `JSON.parse()`. If `hook_text` exceeds 80 chars it is truncated.

### CLI Behavior

The CLI entry point only executes when `process.argv[1]` includes `'generate-script'` — this prevents side effects when the module is imported by `render-video.ts`.

- No args: demo mode with a hardcoded sample reveal and tip item
- With content ID: fetches the row from Supabase, generates the script, updates the row to `status = 'scripted'`

---

## 6. Music Generation

Music generation lives in `src/utils/suno.ts`. It wraps a self-hosted [gcui-art/suno-api](https://github.com/gcui-art/suno-api) server.

### Configuration

| Constant | Value |
|----------|-------|
| Default server | `http://localhost:3000` (overridden by `SUNO_API_URL`) |
| Poll interval | 5 seconds |
| Max polls | 60 (5-minute timeout) |

### generateMusicTrack

```
POST /api/custom_generate
Body: { prompt, tags: prompt, title, make_instrumental: true, wait_audio: false }
```

Returns 2 track candidates; always picks the first. Polls `GET /api/get?ids={id}` until track status is `'streaming'` or `'complete'`.

### downloadAndTrim

Downloads the MP3 to a temporary `.raw.mp3` file, then runs:

```bash
ffmpeg -i {tempFile} -t {seconds} -af afade=t=out:st={fadeStart}:d=3 \
  -codec:a libmp3lame -b:a 192k {outputPath}
```

The fade-out starts 3 seconds before the target duration. The temp file is deleted after trim completes.

The output path is `public/music/{id-prefix}.mp3`, which Remotion can then reference via `staticFile()` during rendering.

---

## 7. Video Rendering System

### Brand and Timing Constants (src/config.ts)

```typescript
BRAND = {
  coral: '#E85A71',
  teal: '#3D9CA8',
  amber: '#FFB74D',
  dark: '#1A1A2E',
  darkSurface: '#16213E',
  white: '#FAFAFA',
  textLight: '#E8E8E8',
  textMuted: '#A0A0B0',
}

VIDEO = { width: 1080, height: 1920, fps: 30 }
```

### Dynamic Timing Functions

Both timing functions are dynamic — they scale duration based on content count. `REVEAL_TIMING` and `TIPS_TIMING` are backward-compatible single-item aliases (`createRevealTiming(1)`, `createTipsTiming(1)`).

**`createRevealTiming(pairCount)`** — per phase in frames at 30fps:

| Phase | Duration |
|-------|----------|
| Hook | 90 frames (3s) |
| Before image (per pair) | 90 frames (3s) |
| Transition (per pair) | 45 frames (1.5s), overlaps 0.5s with before |
| After image (per pair) | 90 frames (3s), overlaps 0.5s with transition |
| Inter-pair gap | 15 frames (0.5s) |
| CTA | 105 frames (3.5s), overlaps 0.5s with last after |

Example for 3 pairs: total = 795 frames = 26.5s.

**`createTipsTiming(tipCount)`** — per phase in frames:

| Phase | Duration |
|-------|----------|
| Hook | 90 frames (3s) |
| Per tip | 240 frames (8s), overlaps 0.5s with previous |
| Takeaway | 90 frames (3s) |
| CTA | 105 frames (3.5s) |

### Composition Props

**RevealProps:**
```typescript
{
  hookText: string;
  imagePairs: { beforeImageSrc: string; afterImageSrc: string; photoEra?: string; label?: string; }[];
  musicFile?: string;
  audioVolume?: number;
  slogan?: string;
  // Backward compat flat props (normalized to imagePairs internally):
  beforeImageSrc?: string;
  afterImageSrc?: string;
  photoEra?: string;
}
```

**TipsProps:**
```typescript
{
  hookText: string;
  tips: { tipTitle: string; tipBody: string; tipImageSrc?: string; tipSource?: string; }[];
  takeaway: string;
  musicFile?: string;
  audioVolume?: number;
  slogan?: string;
  // Backward compat flat props:
  tipTitle?: string;
  tipBody?: string;
  tipImageSrc?: string;
}
```

### calculateMetadata

Both compositions in `Root.tsx` use `calculateMetadata` to compute `durationInFrames` at render time from the actual props. This is how Remotion knows the correct video length for multi-pair content — the duration is not hardcoded.

### Component Responsibilities

| Component | Responsibility |
|-----------|---------------|
| `RevealPair.tsx` | Renders one before/transition/after sequence with Ken Burns zoom, diagonal clip-path wipe, and pan animations |
| `TipCard.tsx` | Renders one tip card with image section, gradient accent bar, source badge, slide-up entrance |
| `HookText.tsx` | Word-by-word animated text overlay with semi-transparent backdrop; only active between `startFrame` and `endFrame` |
| `EternalFrameCTA.tsx` | Branded CTA with app icon, tagline, pulsing button; fade + slide-up entrance |

### Remotion Render Settings

Called via `renderMedia()` from `@remotion/renderer`:

| Setting | Value |
|---------|-------|
| Codec | `h264` |
| Video bitrate | `8M` |
| Audio bitrate | `192k` |
| Output | `{OUTPUT_DIR}/{type}-{id-prefix}.mp4` |

---

## 8. TikTok API Integration

All TikTok logic lives in `scripts/lib/tiktok-api.ts` as the `TikTokClient` class.

### Token Resolution Order

`getAccessToken()` tries sources in this order:

1. In-memory cache (set on first successful resolution)
2. `tiktok_tokens` table in Supabase (auto-refreshes if within 5-minute expiry buffer)
3. `TIKTOK_ACCESS_TOKEN` environment variable (static, no refresh)
4. Returns `null` → pipeline falls back to manual upload logging

`refreshToken(token)` calls `POST /v2/oauth/token/` with `grant_type=refresh_token`. On failure, throws `TokenExpiredError`.

### Error Classes

| Class | Trigger | Retry behavior |
|-------|---------|---------------|
| `TokenExpiredError` | Refresh failed | Not retried (permanent) |
| `ScopeError` | `scope_not_authorized` in 401 body | Not retried; triggers inbox fallback |
| `RateLimitError` | HTTP 429 | Waits `Retry-After` seconds, then retries |
| `VideoProcessingError` | TikTok returns `FAILED` status | Not retried |
| `TikTokApiError` | All other API errors | Default retry behavior |

### Retry Policy

`withRetry<T>(fn, options)` uses exponential backoff with jitter:

| Option | Default |
|--------|---------|
| `maxRetries` | 3 |
| `baseDelayMs` | 1000 |
| `maxDelayMs` | 30000 |

Permanent error classes (`TokenExpiredError`, `ScopeError`, HTTP 400/403) bypass retries immediately.

### Upload Flow

`initVideoPublish(filePath, title)` implements a two-mode fallback:

1. **Direct Post** (`video.publish` scope): `POST /v2/post/publish/video/init/` → `uploadVideoFile()` → `pollPublishStatus()`.
2. **Inbox Upload** (`video.upload` scope): triggered automatically on `ScopeError` from step 1. Uses `POST /v2/post/publish/inbox/video/init/`. Video lands in the creator's TikTok inbox for manual review before publishing.

`uploadVideoFile()` splits files into 10MB chunks with `Content-Range` headers. The last chunk gets the remaining bytes.

`pollPublishStatus()` polls `POST /v2/post/publish/status/fetch/` using increasing intervals:

| Poll # | Interval |
|--------|----------|
| 1–5 | 5s |
| 6–10 | 10s |
| 11–15 | 15s |
| 16–20 | 20s |
| 21+ | 30s |

Max wait: 5 minutes (configurable via `maxWaitMs`). Terminal statuses: `PUBLISH_COMPLETE`, `FAILED`.

---

## 9. Dashboard API Reference

The dashboard server (`dashboard/server.ts`) runs Express on port 3001. It serves `index.html` at `/` and the `public/` directory at `/static`.

### Content Endpoints

| Method | Path | Request Body | Response | Description |
|--------|------|-------------|----------|-------------|
| GET | `/api/content` | — | `ContentRow[]` | All items, newest first |
| GET | `/api/content/:id` | — | `ContentRow` | Single item |
| POST | `/api/content` | `{content_type, ...fields}` | `ContentRow` | Create item |
| PATCH | `/api/content/:id` | `{partial fields}` | `ContentRow` | Update item fields |
| DELETE | `/api/content/:id` | — | `{ok: true}` | Delete item |
| POST | `/api/content/:id/regenerate` | — | `GeneratedScript` | Regenerate AI script for item |

### Pipeline Endpoints

| Method | Path | Request Body | Response | Description |
|--------|------|-------------|----------|-------------|
| GET | `/api/stats` | — | `{status, content_type, count}[]` | Counts from `content_pipeline_stats` view |
| GET | `/api/schedule` | — | `ContentRow[]` | Scheduled items ordered by date |
| POST | `/api/pipeline/run` | `{dryRun?, postOnly?, contentId?}` | `{ok, runId}` | Spawn pipeline child process |
| GET | `/api/pipeline/status` | — | `{running, output, exitCode?}` | Current run state |
| GET | `/api/pipeline/history` | — | `RunLog[]` | Last 20 runs from `pipeline_run_log` |

The pipeline run spawns `node --env-file=.env --import tsx scripts/render-video.ts [args]` as a child process, captures stdout/stderr, and logs to `pipeline_run_log`. Only one pipeline run can be active at a time — the status endpoint returns `{running: true}` while a run is in progress.

### Media and Auth Endpoints

| Method | Path | Request Body | Response | Description |
|--------|------|-------------|----------|-------------|
| POST | `/api/upload-photo` | multipart `file` field | `{url: string}` | Upload to Supabase Storage `photos` bucket (10MB limit) |
| POST | `/api/analyze-photos` | `{beforeUrl, afterUrl}` | `{photo_era, photo_story, preset_used}` | Claude Vision analysis of before/after pair |
| GET | `/api/tiktok/token-status` | — | `{hasToken, expiresAt, isExpired, scope, openId}` | TikTok token info |
| POST | `/api/tiktok/refresh-token` | — | `{ok, expiresAt}` | Trigger token refresh |

The photo analysis endpoint sends both image URLs to `claude-sonnet-4-20250514` using the Claude Vision API and returns a JSON object with `photo_era`, `photo_story`, and `preset_used`.

---

## 10. Extending the System

### Adding a New Video Template

1. Add a timing function to `src/config.ts` (follow `createRevealTiming` pattern).
2. Create a composition component in `src/compositions/`.
3. Register in `src/Root.tsx` with `calculateMetadata` reading `durationInFrames` from your timing function.
4. Add the new `content_type` enum value in a new SQL migration.
5. Map the DB row fields to `inputProps` in step 4 (`renderVideo`) of `scripts/render-video.ts`.
6. Update the dashboard Add Content form in `dashboard/index.html`.

### Adding a New Pipeline Step

Insert between existing steps in `main()` of `scripts/render-video.ts`. Follow the existing pattern:
- Check a skip condition first (like `generateAudio` checks `SUNO_API_URL`)
- Update `status` in the DB if the step has a meaningful state
- Consider whether the new status needs a new enum value in the migration

### Adding New Content Fields

1. Write a SQL migration: `ALTER TABLE tiktok_content_pool ADD COLUMN ...`
2. Add the field to the `ContentRow` interface in `scripts/render-video.ts`.
3. Map it to `inputProps` in `renderVideo()` if it affects video output.
4. Add it to the relevant composition's props interface and component logic in `src/`.
5. Add it to the dashboard form in `dashboard/index.html` if it should be user-editable.

---

## 11. Debugging

### Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| "No content items in queue" | No `queued`/`scripted` rows with `scheduled_for <= today` | Add items via dashboard or direct SQL insert |
| "Token expired" | TikTok access token needs refresh | Run `npm run tiktok:setup` to re-authorize |
| "Script generation returned invalid JSON" | Claude response malformed (rare) | Verify `ANTHROPIC_API_KEY` is valid; retry |
| Suno music times out after 5 min | Suno server down or overloaded | Check `SUNO_API_URL` server; pipeline continues without music |
| Remotion bundle fails | Missing dependency or broken import in `src/` | Run `npm install`, check for TypeScript errors |
| "TikTok rejected video" (`VideoProcessingError`) | Video does not meet TikTok specs | Confirm dimensions (1080×1920), codec (h264), valid duration |
| Dashboard "pipeline already running" | Previous run crashed without clearing state | Restart the dashboard server (`npm run dashboard`) |
| Video renders but looks wrong | `inputProps` mismatch | Use `npm run studio` to preview with test props |
| ffmpeg not found during music step | ffmpeg not on `$PATH` | Install ffmpeg: `brew install ffmpeg` (macOS) |
| `TIKTOK_ACCESS_TOKEN` not refreshing | Static env var has no refresh logic | Migrate to OAuth: run `npm run tiktok:setup` |

### Diagnostic Commands

```bash
# Safe full pipeline test — no TikTok posting
npm run pipeline:dry

# Visual template preview at localhost:3000
npm run studio

# Test script generation without DB side effects
npm run generate-script

# Check pipeline stats in Supabase SQL editor
SELECT * FROM content_pipeline_stats;

# Find stuck items (in 'rendering' for > 1 hour)
SELECT id, status, updated_at
FROM tiktok_content_pool
WHERE status = 'rendering'
  AND updated_at < NOW() - INTERVAL '1 hour';

# Recent pipeline run history
SELECT * FROM pipeline_run_log ORDER BY started_at DESC LIMIT 5;

# Next item the pipeline would pick
SELECT * FROM next_content_to_process;
```

To reset a stuck item back to `queued`:

```sql
UPDATE tiktok_content_pool
SET status = 'queued', post_error = NULL
WHERE id = '{item-id}';
```
