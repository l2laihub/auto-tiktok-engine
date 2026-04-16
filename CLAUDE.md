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

# Full pipeline: fetch -> script -> music -> render -> upload -> post
npm run pipeline                    # live
npm run pipeline:dry                # render without posting
npm run pipeline -- <content-id>    # specific item
npm run pipeline -- <id> --post-only # skip render, post existing video

# TikTok OAuth setup
npm run tiktok:setup

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
`TikTokClient` class handles OAuth token lifecycle (stored in Supabase `tiktok_tokens` table), FILE_UPLOAD flow, and publish status polling. Tries Direct Post first, falls back to Inbox Upload if scope is insufficient. Custom error classes: `TokenExpiredError`, `ScopeError`, `RateLimitError`, `VideoProcessingError`.

### Music generation (src/utils/lyria.ts, src/utils/suno.ts)
Background music via Google Lyria 3 (preferred, `GOOGLE_API_KEY`) or Suno AI (fallback, `SUNO_API_URL`). Lyria 3 Clip generates 30-second instrumental MP3 clips via the Gemini API. Suno requires a self-hosted `gcui-art/suno-api` server with browser cookies. Both are trimmed to video duration with ffmpeg fade-out. Files saved to `public/music/` for Remotion's `staticFile()`.

### Dashboard (dashboard/)
Express server with HTML frontend for content management. Runs on port 3001. Provides CRUD for content pool, pipeline execution, and image upload via multer.

## Tech Stack

- **Database**: Supabase PostgreSQL (schema in `supabase/migration.sql`)
- **Video rendering**: Remotion 4.x (React-based, H.264, 1080x1920 @ 30fps)
- **AI scripting**: Claude API (Sonnet) via `@anthropic-ai/sdk`
- **Runtime**: Node.js + TypeScript, executed via `tsx`

## Brand Constants

Defined in `src/config.ts` as `BRAND`: coral `#E85A71`, teal `#3D9CA8`, amber `#FFB74D`, dark `#1A1A2E`. All Remotion components reference these.

## Environment Variables

Required: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`
Optional: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI`, `TIKTOK_ACCESS_TOKEN`, `GOOGLE_API_KEY`, `SUNO_API_URL`, `SUNO_COOKIE`, `OUTPUT_DIR`

See `.env.example` for details. Without TikTok tokens, pipeline saves videos for manual upload. Without `GOOGLE_API_KEY` or `SUNO_API_URL`, music generation is skipped. Lyria 3 is preferred over Suno when both are configured.
