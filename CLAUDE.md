# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Automated pipeline that generates and publishes branded TikTok short-form videos for the EternalFrame iOS app (@huybuilds). The pipeline: content pool (Supabase) -> AI script (Claude API) -> music generation (Suno AI) -> video render (Remotion) -> upload (Supabase Storage) -> post (TikTok API v2).

Two video templates: **BeforeAfterReveal** (before/after photo transformations) and **TipsEducational** (tips/educational content). Both support dynamic multi-item content (multiple image pairs or multiple tips) with auto-calculated video duration.

## Commands

```bash
# Preview templates in Remotion Studio (browser)
npm run studio

# Render specific template to output/
npm run render:reveal
npm run render:tips

# Generate AI script (demo mode, no Supabase needed)
npm run generate-script

# AI image generation (Gemini Nano Banana Pro, needs GOOGLE_API_KEY)
npm run generate:photos                       # self-source a reveal item (heavily damaged->restored)
npm run generate:photos -- --pairs 3 --hint "Vietnamese wedding photos"
npm run generate:photos -- --damage "water-damaged 1960s Polaroid, mildew"  # steer the damage
npm run generate:tip-images -- <content-id>   # add bg + b-roll imagery to a tip item
npm run generate:tip-content -- --count 4 --hint "scanning old prints"  # self-source a multi-tip item
npm run verify:image-gen                       # smoke test -> output/verify-before|after.png

# Unit tests (node:test via tsx — pure functions only)
npm test

# Full pipeline: fetch -> script -> images -> music -> render -> upload -> post
npm run pipeline                    # live
npm run pipeline:dry                # render without posting
npm run pipeline -- <content-id>    # specific item
npm run pipeline -- <id> --post-only # skip render, post existing video

# TikTok OAuth setup
npm run tiktok:setup
npm run tiktok:setup -- --account nk-nails   # authorize a client account (log into their TikTok first)

# Dashboard (Express server on port 3001)
npm run dashboard
```

Scripts use `node --env-file=.env --import tsx` for execution (no ts-node).

## Architecture

### Pipeline flow (scripts/render-video.ts)
6-step sequential pipeline: `fetchNextItem()` -> `ensureScript()` -> `generateAudio()` -> `renderVideo()` -> `uploadVideo()` -> `postToTikTok()`. Each step updates the content item's status in Supabase (`queued` -> `scripted` -> `rendering` -> `rendered` -> `posted`/`failed`).

### Dynamic timing system (src/config.ts)
Video duration is not fixed at 15s. `createRevealTiming(pairCount)` and `createTipsTiming(tipCount)` compute frame-based timing dynamically. Each phase (hook, content, transition, CTA) has overlapping boundaries. The `REVEAL_TIMING` and `TIPS_TIMING` constants are backward-compatible single-item aliases.

Compositions use `calculateMetadata` in Root.tsx to set `durationInFrames` based on input props at render time.

### Remotion compositions (src/compositions/)
- **BeforeAfterReveal**: Takes `imagePairs[]` array (multi-pair support). Each pair gets Ken Burns zoom (before), diagonal clip-path wipe transition, and horizontal pan (after). Delegates per-pair rendering to `RevealPair` component.
- **TipsEducational**: Takes `tips[]` array (multi-tip support). Each tip gets a card with gradient accent bar. Has animated particles background.

Both compositions accept optional `musicFile` (relative path from `public/` for `staticFile()`, or HTTP URL) and `audioVolume`.

### TikTok posting (scripts/lib/tiktok-api.ts)
`TikTokClient` class handles OAuth token lifecycle (stored in Supabase `tiktok_tokens` table, one row per account — `id` is the account key, `'default'` = @huybuilds), FILE_UPLOAD flow, and publish status polling. The constructor takes an optional account name; client accounts are authorized with `npm run tiktok:setup -- --account <name>` (the account must be a target user of the TikTok developer app, and consent is granted while logged into that account). Tries Direct Post first, falls back to Inbox Upload if scope is insufficient. Custom error classes: `TokenExpiredError`, `ScopeError`, `RateLimitError`, `VideoProcessingError`.

### Inbox caption notifier (scripts/lib/telegram.ts)
Because Direct Post requires the `video.publish` scope, posts fall back to **Inbox Upload**, which can't carry a caption — it must be typed by hand when finishing the draft in the TikTok app. When a video lands in the inbox (the `mode === 'inbox'` branch of `render-video.ts`), `notifyInboxVideo()` pushes a Telegram message with the copy-paste-ready caption + hashtags, content id/type, scheduled time, a thumbnail (reused public image URL), and a `#item-<shortId>` dashboard deep link. Pure builders (`buildInboxMessage`, `resolveThumbnail`, `buildDashboardUrl`) are unit-tested; the `fetch` send wrapper never throws so a notifier failure can't fail a post. Requires `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` (and optional `DASHBOARD_BASE_URL` for the link); absent → silently skipped, like the music/image steps.

### Music generation (src/utils/lyria.ts, src/utils/suno.ts)
Background music via Google Lyria 3 (preferred, `GOOGLE_API_KEY`) or Suno AI (fallback, `SUNO_API_URL`). Lyria 3 Clip generates 30-second instrumental MP3 clips via the Gemini API. Suno requires a self-hosted `gcui-art/suno-api` server with browser cookies. Both are trimmed to video duration with ffmpeg fade-out. Files saved to `public/music/` for Remotion's `staticFile()`.

### Image generation (src/utils/image-gen.ts, src/utils/storage.ts)
Gemini `gemini-3-pro-image-preview` (Nano Banana Pro) via the same `@google/genai` SDK + `GOOGLE_API_KEY`, set as the env-overridable `IMAGE_MODEL` constant in `src/utils/image-gen.ts` (set `IMAGE_MODEL=gemini-2.5-flash-image` to fall back to the cheaper/faster original Nano Banana). `generateImage()` does text→image and image→image edits; `uploadImageBuffer()` saves results to the Supabase `photos` bucket (`generated/` prefix) and returns a public URL. Two uses:
- **Self-sourced reveals** (`scripts/generate-reveal-photos.ts`): Claude invents a family-photo scenario → generate a HEAVILY damaged "before" (deep tears, missing corners, water stains, mold, heavy fade — see `buildBeforePrompt`) → image-edit it into a restored "after" (same subject) → create a queued `reveal` item with `image_pairs`. Each pair persists its `subject`/`story`/`damage_notes` so it can be faithfully regenerated. Damage can be steered with `--damage "<notes>"` (CLI) or the dashboard "Damage notes" field. No manual photo upload needed.
- **Tip imagery** (`scripts/generate-tip-images.ts`): generate a background + b-roll images per tip, stored in `tip_image_url` / `tip_images` (migration-v3). `tip_icon` emoji is chosen by Claude during scripting.
- **Self-sourced tips** (`scripts/generate-tip-content.ts`): Claude invents 4–6 tips (text + emoji) → generate a background per tip → create a queued `tip` item with a `tips` JSONB array (migration-v4). The renderer feeds the whole array to `TipsEducational`; it falls back to the legacy single-tip columns when `tips` is null.
- **Regenerating imagery while reviewing**: `POST /api/content/:id/regenerate-images` re-rolls images on an existing item without re-upload — scopes `pair` / `before` / `after` (reveal; `after` re-edits from the current before) and `tip-images` (tip, optionally per `tipIndex`). Surfaced as per-pair / per-tip "🔄 Regen" buttons in the dashboard editor.

The pipeline calls idempotent `ensureRevealPhotos()` / `ensureTipImages()` steps (like `ensureScript()`) — they only generate when imagery is missing and `GOOGLE_API_KEY` is set, persisting URLs so re-renders reuse them. Prompt builders live in `scripts/lib/image-prompts.ts`.

### Dashboard (dashboard/)
Express server with HTML frontend for content management. Runs on port 3001. Provides CRUD for content pool, pipeline execution, and image upload via multer.

### External videos (migration-v6)
Pre-rendered MP4s (e.g. studio-ops `video-post` output in `output/`) are scheduled from the dashboard's Add Content → 🎬 Video sub-tab: `POST /api/external-video` uploads the file to the `videos` bucket (shared TUS helper in `scripts/lib/video-upload.ts`) and inserts a `content_type='external'` item that is *born rendered* (`status='rendered'` + `video_url` + `caption`/`hashtags` + `scheduled_for` + `tiktok_account`). The existing scheduler and the pipeline's post-only short-circuit then post it at its time to the chosen account (`tiktok_account` NULL = default @huybuilds) — externals never go through scripting/music/render. `GET /api/tiktok/accounts` lists token-row ids for the form dropdown; the daily token-refresh cron rotates every account row.

### Auto-post scheduler (dashboard/server.ts)
`scheduled_for` is a `TIMESTAMPTZ` (migration-v5) holding each item's exact post date+time, interpreted in the server's local timezone. A per-minute poll (`startScheduler`) posts any item whose `scheduled_for <= now()` and status is `queued`/`scripted`/`rendered` — there is no global post time, and `rendered` items post without re-rendering. A startup catch-up runs the same check once on boot so a post missed while the process was down still goes out. `SCHEDULE_ENABLED=false` (or the dashboard toggle) pauses it. Date↔ISO conversion lives in `public/schedule-time.js`, shared by the dashboard UI (served at `/static/schedule-time.js`) and `node:test`.

## Tech Stack

- **Database**: Supabase PostgreSQL (schema in `supabase/migration.sql`)
- **Video rendering**: Remotion 4.x (React-based, H.264, 1080x1920 @ 30fps)
- **AI scripting**: Claude API (Sonnet) via `@anthropic-ai/sdk`
- **Runtime**: Node.js + TypeScript, executed via `tsx`

## Brand Constants

Defined in `src/config.ts` as `BRAND`: coral `#E85A71`, teal `#3D9CA8`, amber `#FFB74D`, dark `#1A1A2E`. All Remotion components read them via `useBrand()` (`src/brand.tsx`), which defaults to EternalFrame.

Both compositions accept an optional `brand` input prop (`BrandProps`) to render for another client with no code change: partial `colors` (keys are roles: coral = primary accent, teal = secondary, amber = highlight, dark/darkSurface = backgrounds), `name` (watermark + CTA), `logoSrc` (URL or `public/` path; `""` hides it), `cta` (pill text replacing the App Store badge, e.g. a phone number), `afterLabel` (reveal badge, default "Restored ✦"). Used by studio-ops's `video-post` skill to render client videos: `npx remotion render BeforeAfterReveal --props=<file>.json --output out.mp4`.

## Environment Variables

Required: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`
Optional: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI`, `TIKTOK_ACCESS_TOKEN`, `GOOGLE_API_KEY`, `IMAGE_MODEL`, `SUNO_API_URL`, `SUNO_COOKIE`, `OUTPUT_DIR`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `DASHBOARD_BASE_URL`

See `.env.example` for details. Without TikTok tokens, pipeline saves videos for manual upload. Without `GOOGLE_API_KEY` or `SUNO_API_URL`, music generation is skipped. Without `GOOGLE_API_KEY`, AI image generation (reveal photos + tip imagery) is also skipped. Lyria 3 is preferred over Suno when both are configured.
