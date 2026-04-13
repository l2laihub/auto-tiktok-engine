# Architecture Design Document

## EternalFrame Auto-TikTok Engine

---

## 1. Introduction

The Auto-TikTok Engine is a fully automated pipeline that generates and publishes branded short-form TikTok videos for the EternalFrame iOS app. The system processes content from a Supabase database, generates AI scripts and music, renders videos using Remotion, and posts them to TikTok — all without manual intervention.

### Design Philosophy

- **Sequential pipeline with status tracking**: Each step updates the content item's status in the database, enabling resume-after-failure and observability.
- **Graceful degradation**: Missing services are skipped, not fatal. No Suno API? Skip music. No TikTok token? Save video for manual upload. No content in queue? Exit cleanly.
- **Idempotency**: Steps check existing state before acting. `ensureScript()` skips if `hook_text` exists. `generateAudio()` skips if the music file exists locally.
- **Dynamic composition**: Video duration is not fixed — it scales with content count (1-6 image pairs or multiple tips), with frame-accurate timing computed at render time.

---

## 2. System Overview

> Diagram: [system-overview.drawio](./system-overview.drawio)

### Internal Components

| Component | File | Purpose |
|-----------|------|---------|
| Pipeline Orchestrator | `scripts/render-video.ts` | Runs the 6-step pipeline end-to-end |
| Script Generator | `scripts/generate-script.ts` | Claude API integration for hook/caption/hashtag generation |
| Music Generator | `src/utils/suno.ts` | Suno AI integration for instrumental background tracks |
| Remotion Renderer | `src/compositions/`, `src/components/` | React-based video rendering (1080x1920 H.264) |
| Dashboard | `dashboard/server.ts` + `dashboard/index.html` | Express API + React SPA for content management |

### External Services

| Service | Purpose | Required? |
|---------|---------|-----------|
| Supabase PostgreSQL | Content pool, status tracking, token storage | Yes |
| Supabase Storage | Video and photo file hosting | Yes |
| Claude API (Anthropic) | AI script generation, photo analysis | Yes |
| Suno AI Server | Instrumental music generation | No (skipped if unavailable) |
| TikTok API v2 | Video publishing | No (videos saved for manual upload) |

### Data Flow

```
Browser (Dashboard) ──HTTP API──→ Dashboard Server ──CRUD──→ Supabase PostgreSQL
                                       │
                                  spawn child process
                                       │
                                       ▼
                              Pipeline Orchestrator
                              ┌────────┼────────┐
                              ▼        ▼        ▼
                        Claude API  Suno AI  Remotion
                        (scripts)   (music)  (video)
                              │        │        │
                              └────────┼────────┘
                                       ▼
                              Supabase Storage (upload)
                                       │
                                       ▼
                              TikTok API v2 (publish)
```

---

## 3. Pipeline Architecture

> Diagram: [pipeline-flow.drawio](./pipeline-flow.drawio)

The pipeline (`scripts/render-video.ts`) processes one content item at a time through 6 sequential steps.

### Step-by-Step Flow

| Step | Function | Input | Output | Status Transition |
|------|----------|-------|--------|-------------------|
| 1 | `fetchNextItem()` | Content ID or auto-select | `ContentRow` from DB | — |
| 2 | `ensureScript()` | Content metadata | hook_text, caption, hashtags, slogan | `queued → scripted` |
| 3 | `generateAudio()` | music_style prompt | MP3 file in `public/music/` | — |
| 4 | `renderVideo()` | inputProps + composition ID | MP4 file in OUTPUT_DIR | `scripted → rendering` |
| 5 | `uploadVideo()` | Local MP4 path | Public URL in Supabase Storage | `rendering → rendered` |
| 6 | `postToTikTok()` | Video URL/path + caption | TikTok publish_id | `rendered → posted` or `failed` |

### Status Machine

```
queued ──→ scripted ──→ rendering ──→ rendered ──→ posted
  │           │            │             │           
  └───────────┴────────────┴─────────────┴──→ failed
```

Any step failure sets status to `failed` and stores the error message in `post_error`.

### CLI Flags

| Flag | Behavior |
|------|----------|
| (none) | Process next queued/scripted item, full pipeline |
| `<content-id>` | Process specific item by UUID |
| `--dry-run` | Render video but skip TikTok posting |
| `--post-only` | Skip steps 2-5, post existing video |

### Content Selection Priority

When no specific ID is provided, `fetchNextItem()` selects:
1. Status IN (`queued`, `scripted`)
2. `scheduled_for` is NULL or <= now
3. Ordered by `scheduled_for` ASC (nulls last), then `created_at` ASC

---

## 4. Data Model

> Diagram: [data-model.drawio](./data-model.drawio)

### Tables

#### tiktok_content_pool (main content queue)

The central table tracking each content item through the pipeline. Columns are grouped by concern:

- **Identity**: `id` (UUID), `created_at`, `updated_at` (auto-trigger), `scheduled_for` (DATE), `content_type` (enum), `status` (enum)
- **Reveal fields**: `before_image_url`, `after_image_url`, `image_pairs` (JSONB, 1-6 pairs), `preset_used`, `photo_era`, `photo_story`
- **Tip fields**: `tip_title`, `tip_body`, `tip_image_url`, `tip_source`
- **Script fields** (AI-generated): `hook_text`, `caption`, `hashtags` (TEXT[]), `music_track` (legacy), `music_style` (Suno prompt), `slogan`
- **Audio fields**: `suno_audio_url`, `music_file_path`, `audio_volume` (REAL, default 0.6)
- **Render fields**: `video_url`, `video_duration_ms`, `thumbnail_url`
- **TikTok fields**: `tiktok_post_id`, `posted_at`, `post_error`, `publish_status`
- **Analytics**: `views`, `likes`, `shares`, `comments` (all default 0)

The `image_pairs` JSONB column stores an array of objects:
```json
[
  { "before_url": "...", "after_url": "...", "era": "1960s", "label": "optional" }
]
```
Constrained to 1-6 pairs via `chk_image_pairs_length`.

#### tiktok_music_library
Catalog of available music tracks. Includes Suno-generated fields (`suno_id`, `audio_url`, `prompt`).

#### pipeline_run_log
Execution history for dashboard. FK to `tiktok_content_pool.id`. Records `started_at`, `finished_at`, `dry_run`, `success`, `output`, `error`.

#### tiktok_tokens
Single-row table (`id='default'`) storing OAuth tokens: `access_token`, `refresh_token`, `expires_at`, `scope`, `open_id`.

### Views

| View | Purpose |
|------|---------|
| `next_content_to_process` | Oldest queued item where `scheduled_for` <= today |
| `content_pipeline_stats` | Count of items grouped by (status, content_type) |
| `posted_video_performance` | Posted videos with `engagement_rate = (likes/views) * 100` |

### Enums

- `content_type`: `'reveal'` | `'tip'`
- `content_status`: `'queued'` | `'scripted'` | `'rendering'` | `'rendered'` | `'posted'` | `'failed'`

### Migration Order

Run in sequence in Supabase SQL editor:
1. `supabase/migration.sql` — core schema, tables, views, triggers
2. `supabase/migration_002_dashboard.sql` — pipeline_run_log table
3. `supabase/migration_003_tiktok_tokens.sql` — tiktok_tokens table, publish_status column
4. `supabase/migration-v2.sql` — multi-pair support (image_pairs JSONB), Suno audio fields

---

## 5. Video Rendering Architecture

> Diagram: [video-rendering.drawio](./video-rendering.drawio)

### Dynamic Timing System

Video duration is **not fixed at 15 seconds**. The timing functions in `src/config.ts` compute frame ranges dynamically based on content count:

**`createRevealTiming(pairCount)`** — per-pair reveal:
- Hook: 3s
- Per pair: before (3s) + transition (1.5s) + after (3s), with 0.5s overlaps between phases
- Inter-pair gap: 0.5s
- CTA: 3.5s (overlaps last after by 0.5s)

Example for 3 pairs: ~26.5s total

**`createTipsTiming(tipCount)`** — per-tip educational:
- Hook: 3s
- Per tip: 8s (with 0.5s overlap between consecutive tips)
- Takeaway: 3s
- CTA: 3.5s

Example for 2 tips: ~24.5s total

### Composition Registry (Root.tsx)

Both compositions use `calculateMetadata` to compute `durationInFrames` at render time based on the input props:

```typescript
calculateMetadata={({ props }) => {
  const pairCount = props.imagePairs?.length || 1;
  const timing = createRevealTiming(pairCount);
  return { durationInFrames: timing.totalDuration, fps: 30, width: 1080, height: 1920 };
}}
```

This means the pipeline can pass any number of image pairs/tips and the video length auto-adjusts.

### Component Hierarchy

**BeforeAfterReveal:**
```
BeforeAfterReveal
├── Audio (optional, from musicFile)
├── Hook background (blurred first before-image)
├── RevealPair[] (one per image pair)
│   ├── Before layer: Ken Burns zoom, desaturated, vignette, era badge
│   ├── Transition: diagonal clip-path wipe, white flash
│   └── After layer: horizontal pan, warm overlay, "Restored" badge
├── HookText (word-by-word reveal with glass backdrop)
├── EternalFrameCTA (staggered entrance)
└── Bottom gradient (TikTok UI safe area)
```

**TipsEducational:**
```
TipsEducational
├── Audio (optional)
├── Animated gradient background (angle shifts)
├── Floating particles (6 dots, coral/teal)
├── HookText
├── TipCard[] (one per tip)
│   ├── Tip number badge (if multiple)
│   ├── Optional image (500px)
│   └── Content card (accent bar, title, body, source)
├── Takeaway box (scale entrance, lightning emoji)
├── EternalFrameCTA
└── Bottom gradient
```

### Animation System

All animations are **frame-based**, using the custom `interpolate()` function from `config.ts`:

```typescript
interpolate(frame, inputRange, outputRange, { clamp: true })
```

This supports multi-stop keyframes with `easeInOutCubic` easing. Components use `useCurrentFrame()` to get the current frame and compute transform/opacity/filter values.

Performance optimization: Components return `null` outside their active frame window (e.g., `RevealPair` only renders within `[beforeStart-5, afterEnd+10]`).

### Props Resolution (Pipeline → Remotion)

The pipeline builds `inputProps` from the database row:

| DB Column | Reveal Prop | Tip Prop |
|-----------|-------------|----------|
| `hook_text` | `hookText` | `hookText` |
| `image_pairs` / legacy fields | `imagePairs[]` | — |
| `tip_title`, `tip_body` | — | `tipTitle`, `tipBody` |
| `music_file_path` or `suno_audio_url` | `musicFile` | `musicFile` |
| `audio_volume` | `audioVolume` | `audioVolume` |
| `slogan` | `slogan` | `slogan` |

Music file resolution priority: local file in `public/music/` (for `staticFile()`) → Suno CDN URL → legacy `music_track` filename.

---

## 6. TikTok Integration

> Diagram: [tiktok-oauth-posting.drawio](./tiktok-oauth-posting.drawio)

### OAuth PKCE Flow

Token acquisition uses `scripts/tiktok-oauth-setup.ts`:

1. Generate PKCE pair: 128-char `code_verifier` + SHA256 `code_challenge`
2. Construct auth URL with `client_key`, `scope` (user.info.basic, video.upload), `code_challenge_method=S256`
3. Open browser for user authorization
4. User pastes redirect URL containing the authorization code
5. Exchange code for tokens: POST to `/v2/oauth/token/` with `code_verifier`
6. Store tokens in `tiktok_tokens` table (UPSERT `id='default'`)

### Token Lifecycle

`TikTokClient.getAccessToken()` resolves tokens in this order:

1. **In-memory cache** — if token expires in > 5 minutes
2. **Supabase query** — fetch from `tiktok_tokens` table
3. **Auto-refresh** — if token expires within 5 minutes, POST refresh_token to `/v2/oauth/token/`
4. **Environment variable** — fall back to `TIKTOK_ACCESS_TOKEN` (no auto-refresh)
5. **null** — no token available, videos saved for manual upload

### Posting Strategy

The system tries two approaches in order:

1. **Direct Post** (`initDirectPost`) — requires `video.publish` scope
   - Full automation: video goes live immediately after processing
   - Uses FILE_UPLOAD source with chunked upload (10MB chunks)
   - Polls for publish status: intervals 5s → 10s → 15s → 20s → 30s (max 5 min)

2. **Inbox Upload** (`initInboxUpload`) — fallback if ScopeError on Direct Post
   - Requires only `video.upload` scope (works in sandbox)
   - Video appears in creator's TikTok inbox for manual review
   - No publish status polling needed

### Error Hierarchy

```
TikTokApiError (base)
├── TokenExpiredError  → Run: npm run tiktok:setup
├── ScopeError         → Permanent, triggers Inbox Upload fallback
├── RateLimitError     → Retryable, wait retryAfterSeconds
└── VideoProcessingError → TikTok rejected the video
```

### Retry Behavior

`withRetry()` wraps API calls with exponential backoff:
- Base delay: 1s, multiplied by 2^attempt + random jitter (0-500ms)
- Max delay: 30s, max retries: 3
- **Not retried**: TokenExpiredError, ScopeError, HTTP 400/403 (permanent failures)
- **Retried**: RateLimitError (waits for `retryAfterSeconds`), transient network errors

---

## 7. Dashboard Architecture

### Server (`dashboard/server.ts`)

Express.js server on port 3001 with 14 API endpoints:

| Category | Endpoints |
|----------|-----------|
| Content CRUD | GET/POST/PATCH/DELETE `/api/content`, POST `/api/content/:id/regenerate` |
| Stats | GET `/api/stats`, GET `/api/schedule` |
| Photos | POST `/api/upload-photo`, POST `/api/analyze-photos` |
| Pipeline | POST `/api/pipeline/run`, GET `/api/pipeline/status`, GET `/api/pipeline/history` |
| TikTok | GET `/api/tiktok/token-status`, POST `/api/tiktok/refresh-token` |

### Pipeline Execution Model

The dashboard does not run the pipeline in-process. Instead:
1. `POST /api/pipeline/run` spawns a child process: `node --env-file=.env --import tsx scripts/render-video.ts [args]`
2. stdout/stderr are captured into a buffer
3. On process exit: result is logged to `pipeline_run_log` table
4. Dashboard polls `/api/pipeline/status` for live terminal output

### Frontend (`dashboard/index.html`)

Single-file React SPA (no build step). Uses React 18 via CDN + htm tagged templates. Four tabs:

1. **Content Pool** — table view with inline editing, script regeneration, auto-refresh during active processing
2. **Schedule** — 3-week Mon/Wed/Fri calendar with drag-and-drop rescheduling
3. **Add Content** — multi-pair photo upload with AI auto-fill (Claude Vision), tip creation
4. **Pipeline** — stats cards, run controls (dry-run/post-only toggles), live terminal output, run history

### Photo Analysis

`POST /api/analyze-photos` sends before/after image URLs to Claude Vision (claude-sonnet-4-20250514), which returns:
```json
{
  "photo_era": "estimated decade",
  "photo_story": "2-3 sentence description",
  "preset_used": "photo-restoration | vintage-colorize | face-restoration | damage-repair | full-enhancement"
}
```

---

## 8. Music Generation Subsystem

### Integration

Uses a self-hosted `gcui-art/suno-api` server (Docker). The `src/utils/suno.ts` utility provides:

1. **`generateMusicTrack(opts)`** — POST to `/api/custom_generate` with style prompt, then poll `/api/get` until status is `streaming` or `complete` (max 5 minutes, 5s intervals)
2. **`downloadAndTrim(opts)`** — download MP3 from Suno CDN, then ffmpeg trim to target duration with 3-second fade-out

### Pipeline Integration

In step 3 (`generateAudio`), the pipeline:
1. Computes target duration from the content's timing (`createRevealTiming(pairCount)` or `createTipsTiming(tipCount)`)
2. Uses `music_style` (from AI script generation) as the Suno prompt
3. Saves trimmed MP3 to `public/music/{id-prefix}.mp3`
4. Remotion compositions load this via `staticFile()` during rendering

### Graceful Degradation

- No `SUNO_API_URL` environment variable → music generation skipped entirely
- Suno API failure → warning logged, pipeline continues without background music
- Music file already exists locally → skipped (no re-generation)
