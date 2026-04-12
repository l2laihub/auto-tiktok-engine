# CLAUDE.md — EternalFrame Auto-TikTok Engine

## Project Overview

An automated pipeline that generates and publishes 2-3 branded TikTok short-form videos per week for the EternalFrame iOS app (@huybuilds account). Zero manual intervention after content is queued.

## Goals

- Fully automated: content pool → AI script → video render → TikTok post
- Two video templates: before/after photo reveals + tips/educational
- EternalFrame branded (coral #E85A71, teal #3D9CA8, amber #FFB74D)
- 15-second vertical videos (1080×1920, H.264, 30fps)
- Scheduled 3x/week (Mon/Wed/Fri)

## Non-Goals

- No web UI or dashboard (monitoring via SQL views)
- No multi-user support (single account: @huybuilds)
- No real-time processing (batch/scheduled only)
- No analytics scraping from TikTok (manual check for now)

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Database | Supabase PostgreSQL | Content pool, status tracking, music library |
| Video Rendering | Remotion 4.x (React) | Programmatic video generation |
| AI Script Gen | Claude API (Sonnet) | Hook text, captions, hashtags |
| Video Posting | TikTok Content Posting API v2 | Automated publishing |
| Orchestration | n8n or pg_cron | Scheduling triggers |
| Runtime | Node.js + TypeScript + tsx | Script execution |

## Architecture

```
Scheduler (n8n/pg_cron: Mon/Wed/Fri)
    │
    ▼
Content Pool (Supabase: tiktok_content_pool table)
    │ SELECT next queued item
    ▼
AI Script Generation (Claude API)
    │ Generate hook, caption, hashtags
    ▼
Video Rendering (Remotion)
    │ Template A (reveal) or Template B (tips)
    ▼
Upload to Supabase Storage
    │
    ▼
Post to TikTok (Content Posting API v2)
    │
    ▼
Update status → 'posted', log analytics
```

## File Structure

```
auto-tiktok-engine/
├── CLAUDE.md
├── .env.example
├── README.md
├── package.json
├── tsconfig.json
├── supabase/
│   └── migration.sql
├── src/
│   ├── index.ts
│   ├── Root.tsx
│   ├── config.ts
│   ├── components/
│   │   ├── EternalFrameCTA.tsx
│   │   └── HookText.tsx
│   └── compositions/
│       ├── BeforeAfterReveal.tsx
│       └── TipsEducational.tsx
└── scripts/
    ├── generate-script.ts
    └── render-video.ts
```

## Task Verification Checklist

Use this to verify every requirement has been implemented.

### Database Layer (supabase/migration.sql)

- [ ] `content_type` enum: 'reveal', 'tip'
- [ ] `content_status` enum: 'queued', 'scripted', 'rendering', 'rendered', 'posted', 'failed'
- [ ] `tiktok_content_pool` table with all required columns:
  - [ ] id (UUID, PK, auto-generated)
  - [ ] created_at, updated_at (timestamptz, auto-managed)
  - [ ] scheduled_for (date, nullable)
  - [ ] content_type (enum, NOT NULL)
  - [ ] status (enum, NOT NULL, default 'queued')
  - [ ] Reveal fields: before_image_url, after_image_url, preset_used, photo_era, photo_story
  - [ ] Tip fields: tip_title, tip_body, tip_image_url, tip_source
  - [ ] Script fields: hook_text, caption, hashtags (text[]), music_track
  - [ ] Render fields: video_url, video_duration_ms, thumbnail_url
  - [ ] TikTok fields: tiktok_post_id, posted_at, post_error
  - [ ] Analytics fields: views, likes, shares, comments (all default 0)
- [ ] `tiktok_music_library` table: id, filename, title, mood, duration_ms, bpm, source, license
- [ ] Index on (status, scheduled_for) for scheduler queries
- [ ] Index on (posted_at DESC) for analytics queries
- [ ] `update_updated_at()` trigger function
- [ ] `next_content_to_process` view: oldest queued item with scheduled_for <= today
- [ ] `content_pipeline_stats` view: count by status and content_type
- [ ] `posted_video_performance` view: posted videos with engagement_rate calculation

### Config (src/config.ts)

- [ ] BRAND object: coral (#E85A71), teal (#3D9CA8), amber (#FFB74D), dark, darkSurface, white, textLight, textMuted
- [ ] VIDEO object: width (1080), height (1920), fps (30)
- [ ] REVEAL_TIMING object with frame-based timing for 5 phases:
  - [ ] Hook: 0–2s
  - [ ] Before image: 0.5–6s (with slow zoom)
  - [ ] Transition: 5.5–7s (diagonal swipe)
  - [ ] After image: 6.5–12s (with slow pan)
  - [ ] CTA: 11.5–15s
- [ ] TIPS_TIMING object with frame-based timing for 4 phases:
  - [ ] Hook: 0–3s
  - [ ] Tip content: 2.5–10s
  - [ ] Takeaway: 9.5–12.5s
  - [ ] CTA: 12–15s
- [ ] easeOutCubic() function
- [ ] easeInOutCubic() function
- [ ] interpolate() function with input/output ranges and clamp option

### Remotion Setup (src/index.ts, src/Root.tsx)

- [ ] index.ts: calls registerRoot(RemotionRoot)
- [ ] Root.tsx: registers two Composition components:
  - [ ] "BeforeAfterReveal" — uses REVEAL_TIMING.totalDuration, VIDEO dimensions
  - [ ] "TipsEducational" — uses TIPS_TIMING.totalDuration, VIDEO dimensions
- [ ] Both compositions have defaultProps with realistic placeholder content
- [ ] Props interfaces exported: RevealProps, TipsProps

### Component: HookText (src/components/HookText.tsx)

- [ ] Props: text, startFrame, endFrame, fontSize (default 56), position (center/top/bottom)
- [ ] Animations: fade in, fade out, slide up, scale pop
- [ ] Multi-line support via text.split('\n')
- [ ] Semi-transparent dark backdrop with rounded corners
- [ ] Only renders between startFrame and endFrame
- [ ] Uses BRAND colors from config

### Component: EternalFrameCTA (src/components/EternalFrameCTA.tsx)

- [ ] Props: startFrame, endFrame
- [ ] Fade + slide up entrance animation
- [ ] App icon placeholder with coral→teal gradient
- [ ] "EternalFrame" app name text
- [ ] Tagline: "Restore your family memories with AI"
- [ ] CTA button with subtle pulse animation (after 30 frames)
- [ ] "Try it free →" button text in coral
- [ ] "Available on iOS · eternalframe.app/try" footer text
- [ ] Only renders between startFrame and endFrame
- [ ] Uses BRAND colors from config

### Template A: BeforeAfterReveal (src/compositions/BeforeAfterReveal.tsx)

- [ ] Props: hookText, beforeImageSrc, afterImageSrc, photoEra?, musicFile?
- [ ] Before image phase:
  - [ ] Slow Ken Burns zoom (1.0 → 1.15 scale)
  - [ ] Desaturated filter (saturate 0.7)
  - [ ] Dark radial vignette overlay
  - [ ] "Before" label badge (top-left, semi-transparent dark bg)
  - [ ] Era badge (top-right, amber background) when photoEra provided
- [ ] Transition phase:
  - [ ] Diagonal clip-path wipe (polygon)
  - [ ] Brief white flash at midpoint
- [ ] After image phase:
  - [ ] Slow horizontal pan (translateX -20 → 20)
  - [ ] Slight zoom out (1.05 → 1.0)
  - [ ] Warm amber overlay tint
  - [ ] "Restored ✦" label badge (teal background)
- [ ] HookText component rendered at hookStart–hookEnd
- [ ] EternalFrameCTA component rendered at ctaStart–ctaEnd
- [ ] Bottom gradient overlay for TikTok UI safe area (180px)
- [ ] Optional Audio component for background music
- [ ] Uses AbsoluteFill, Img, Audio from remotion

### Template B: TipsEducational (src/compositions/TipsEducational.tsx)

- [ ] Props: hookText, tipTitle, tipBody, takeaway, tipImageSrc?, musicFile?
- [ ] Animated dark gradient background (angle shifts over time)
- [ ] Decorative floating particles (6 particles, coral/teal alternating)
- [ ] Hook phase: HookText component with question
- [ ] Tip card phase:
  - [ ] Optional image section (500px height, rounded)
  - [ ] Content card with dark semi-transparent background
  - [ ] Coral→teal gradient accent bar (60px wide)
  - [ ] Tip title (40px, bold) and body (28px, regular)
  - [ ] "From 100+ prompt experiments" source badge (teal)
  - [ ] Slide up + fade in entrance, fade out exit
- [ ] Takeaway phase:
  - [ ] Emphasis card with gradient border
  - [ ] Lightning emoji icon
  - [ ] Scale + fade entrance animation
- [ ] EternalFrameCTA component
- [ ] Bottom gradient overlay for TikTok safe area
- [ ] Optional Audio component

### AI Script Generation (scripts/generate-script.ts)

- [ ] ContentItem interface: id, content_type, photo_era?, photo_story?, preset_used?, tip_title?, tip_body?, tip_source?
- [ ] GeneratedScript interface: hook_text, caption, hashtags, music_mood, takeaway?
- [ ] SYSTEM_PROMPT with:
  - [ ] EternalFrame brand voice (warm, nostalgic, personal, never salesy)
  - [ ] Target audience definition (30-65, Vietnamese-American segment)
  - [ ] Hook text rules (max 60 chars, emotional triggers)
  - [ ] Caption rules (150-300 chars, micro-story, soft CTA)
  - [ ] Hashtag rules (5-8, mix broad and niche)
  - [ ] JSON-only response format instruction
- [ ] buildUserPrompt() function:
  - [ ] Reveal type: includes photo era, story, preset in prompt
  - [ ] Tip type: includes title, body, source; requests takeaway field
- [ ] generateScript() function:
  - [ ] Calls Claude API (claude-sonnet-4-20250514, max_tokens 500)
  - [ ] Parses JSON response, strips markdown fences
  - [ ] Validates hook length (truncates if > 80 chars)
- [ ] CLI entry point:
  - [ ] No args: runs demo with sample reveal + tip content
  - [ ] With content ID arg: fetches from Supabase, generates script, updates row to 'scripted'

### Pipeline Orchestrator (scripts/render-video.ts)

- [ ] Environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OUTPUT_DIR, TIKTOK_ACCESS_TOKEN
- [ ] --dry-run flag support (renders without posting)
- [ ] Step 1 — fetchNextItem():
  - [ ] Fetches specific item by ID if provided
  - [ ] Otherwise fetches next queued/scripted item with scheduled_for <= now
  - [ ] Returns null if no items in queue
- [ ] Step 2 — ensureScript():
  - [ ] Skips if item already has hook_text
  - [ ] Calls generateScript() from generate-script.ts
  - [ ] Updates Supabase row with hook_text, caption, hashtags, music_track
  - [ ] Sets status to 'scripted'
- [ ] Step 3 — renderVideo():
  - [ ] Updates status to 'rendering'
  - [ ] Bundles Remotion project via @remotion/bundler
  - [ ] Selects composition based on content_type ('BeforeAfterReveal' or 'TipsEducational')
  - [ ] Builds inputProps from content row fields
  - [ ] Renders via renderMedia() with h264 codec, 8M video bitrate, 192k audio
  - [ ] Outputs to OUTPUT_DIR with filename: {type}-{id-prefix}.mp4
- [ ] Step 4 — uploadVideo():
  - [ ] Reads rendered file from disk
  - [ ] Uploads to Supabase Storage bucket 'videos' at path tiktok-videos/{filename}
  - [ ] Gets public URL
  - [ ] Updates row with video_url, status 'rendered'
- [ ] Step 5 — postToTikTok():
  - [ ] Dry run: logs caption and hashtags, skips posting
  - [ ] No token: logs video path for manual upload
  - [ ] With token: calls TikTok Content Posting API v2
    - [ ] POST to /v2/post/publish/video/init/
    - [ ] Includes: title (caption + hashtags), privacy_level PUBLIC_TO_EVERYONE, source PULL_FROM_URL
    - [ ] On success: updates tiktok_post_id, posted_at, status 'posted'
    - [ ] On failure: updates post_error, status 'failed'
- [ ] Main function: runs all 5 steps sequentially with console logging

### Project Config Files

- [ ] package.json:
  - [ ] Dependencies: @anthropic-ai/sdk, @remotion/bundler, @remotion/cli, @remotion/renderer, @supabase/supabase-js, react, react-dom, remotion, tsx
  - [ ] DevDependencies: @types/react, typescript
  - [ ] Scripts: studio, render:reveal, render:tips, generate-script, pipeline, pipeline:dry
- [ ] tsconfig.json: target ES2022, module ESNext, jsx react-jsx, strict true
- [ ] .env.example: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, TIKTOK_ACCESS_TOKEN, OUTPUT_DIR

### README.md

- [ ] Architecture diagram (ASCII)
- [ ] Quick start guide (5 steps: install, env, migration, preview, seed content)
- [ ] SQL examples for seeding reveal and tip content
- [ ] Pipeline usage commands (dry run, full, specific ID)
- [ ] Video template timing tables for both templates
- [ ] Content pipeline status flow diagram
- [ ] n8n scheduling instructions with cron expression
- [ ] pg_cron alternative with SQL example
- [ ] TikTok API setup steps (developer account → app review → OAuth)
- [ ] Monitoring SQL queries (pipeline stats, stuck items)
- [ ] File structure reference
- [ ] Customization guide (brand, timing, voice, music, CTA)

## Development Workflow

```bash
# Preview templates in browser
npm run studio

# Test script generation (demo mode)
npm run generate-script

# Render a test video
npm run render:reveal
npm run render:tips

# Run full pipeline (dry run)
npm run pipeline:dry

# Run full pipeline (live)
npm run pipeline
```

## Environment Setup

```bash
cp .env.example .env
# Fill in: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY
# Optional: TIKTOK_ACCESS_TOKEN (leave blank for manual upload mode)
npm install
```
