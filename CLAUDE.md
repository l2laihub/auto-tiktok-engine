# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Automated TikTok video generation pipeline for EternalFrame (AI photo restoration iOS app). Generates branded short-form videos from a Supabase content pool using Claude API for scriptwriting and Remotion for video rendering, then posts to TikTok.

## Commands

```bash
# Preview video templates in browser (Remotion Studio)
npm run studio

# Render a specific template preview
npm run render:reveal
npm run render:tips

# Generate AI script from content metadata (demo mode if no ID)
npm run generate-script

# Full pipeline: fetch → script → render → upload → post
npm run pipeline              # full run
npm run pipeline:dry          # render only, skip TikTok posting
npx tsx scripts/render-video.ts <content-id>  # specific item
```

## Architecture

**Pipeline flow:** `queued → scripted → rendering → rendered → posted` (or `failed`)

The pipeline (`scripts/render-video.ts`) orchestrates 5 steps:
1. Fetch next content item from Supabase `tiktok_content_pool` table
2. Generate hook text, caption, hashtags via Claude API (`scripts/generate-script.ts`)
3. Bundle and render video with Remotion (selects composition by `content_type`)
4. Upload `.mp4` to Supabase Storage
5. Post via TikTok Content Posting API v2 (or skip if no token / dry-run)

**Two video templates** (both 15s @ 30fps, 1080x1920):
- `BeforeAfterReveal` — before/after photo reveal with swipe transition
- `TipsEducational` — educational tip card with hook question and takeaway

**Key wiring:**
- `src/Root.tsx` registers both Remotion compositions with default props
- `src/config.ts` holds brand colors (`BRAND`), video dimensions (`VIDEO`), and frame-level timing constants (`REVEAL_TIMING`, `TIPS_TIMING`)
- `render-video.ts` maps `content_type` field to composition ID: `'reveal'` → `BeforeAfterReveal`, `'tip'` → `TipsEducational`
- Script generation uses `claude-sonnet-4-20250514` with a brand-voice system prompt; output is raw JSON

## Environment Variables

Defined in `.env` (see `.env.example`):
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — shared EternalFrame Supabase project
- `ANTHROPIC_API_KEY` — for Claude script generation
- `TIKTOK_ACCESS_TOKEN` — optional; without it videos render to `./output/` for manual upload
- `OUTPUT_DIR` — defaults to `./output`

## Database

Schema lives in `supabase/migration.sql`. Run it in the Supabase SQL editor (not via CLI migrations). Two tables:
- `tiktok_content_pool` — main content queue (one row = one potential video)
- `tiktok_music_library` — royalty-free tracks by mood

Helper views: `next_content_to_process`, `content_pipeline_stats`, `posted_video_performance`

## Tech Stack

- **Remotion 4** — React-based video rendering (compositions in `src/compositions/`, shared components in `src/components/`)
- **Claude API** (`@anthropic-ai/sdk`) — script generation
- **Supabase** — content pool DB + video storage
- **TypeScript** with `tsx` for script execution
