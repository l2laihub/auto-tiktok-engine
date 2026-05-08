# EternalFrame Auto-TikTok Engine

Fully automated TikTok video generation pipeline for EternalFrame. Generates 2-3 branded short-form videos per week from a content pool, with zero manual intervention.

## Architecture

```
┌─────────────────────────────────────────┐
│  Scheduler (n8n or pg_cron)             │
│  Mon / Wed / Fri at optimal time        │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│  Content Pool (Supabase)                │
│  ┌──────────────┐  ┌──────────────────┐ │
│  │ Before/after  │  │ Tips/educational │ │
│  │ photo pairs   │  │ from autoresearch│ │
│  └──────────────┘  └──────────────────┘ │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│  AI Script Generation (Claude API)      │
│  Hook text, caption, hashtags           │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│  Video Rendering (Remotion)             │
│  ┌──────────────┐  ┌──────────────────┐ │
│  │ Template A:   │  │ Template B:      │ │
│  │ Reveal        │  │ Tips             │ │
│  └──────────────┘  └──────────────────┘ │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│  Post to TikTok (Content Posting API)   │
└─────────────────────────────────────────┘
```

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Set up environment variables

```bash
cp .env.example .env
# Edit .env with your keys:
#   SUPABASE_URL=https://your-project.supabase.co
#   SUPABASE_SERVICE_ROLE_KEY=your-key
#   ANTHROPIC_API_KEY=your-key
#   TIKTOK_ACCESS_TOKEN=your-token  (optional, for auto-posting)
```
### 2.2 Run dashboard locally
```bash
npm run dashboard
```

### 3. Run the database migration

```bash
# In your Supabase dashboard SQL editor, run:
# supabase/migration.sql
```

### 4. Preview templates in Remotion Studio

```bash
npm run studio
# Opens http://localhost:3000 — preview both templates with default props
```

### 5. Add content to the pool

```sql
-- Example: Add a before/after reveal
INSERT INTO tiktok_content_pool (content_type, before_image_url, after_image_url, photo_era, photo_story, preset_used, scheduled_for)
VALUES (
  'reveal',
  'https://your-bucket.supabase.co/storage/v1/object/public/photos/before-001.jpg',
  'https://your-bucket.supabase.co/storage/v1/object/public/photos/after-001.jpg',
  '1960s',
  'Wedding photo of Vietnamese grandparents, found in water-damaged album',
  'vintage-colorize',
  '2026-04-14'
);

-- Example: Add a tip
INSERT INTO tiktok_content_pool (content_type, tip_title, tip_body, tip_source, scheduled_for)
VALUES (
  'tip',
  'Why AI faces look wrong in restored photos',
  'Most AI models distort facial features during restoration. After 100+ prompt iterations, we found that explicit identity anchoring reduces face drift by 73%.',
  'EternalFrame autoresearch',
  '2026-04-16'
);
```

### 6. Run the pipeline

```bash
# Dry run (renders video but doesn't post)
npm run pipeline:dry

# Full pipeline (renders + posts to TikTok)
npm run pipeline

# Process specific content item
npx tsx scripts/render-video.ts <content-id>
```

## Video Templates

### Template A: Before/After Reveal (15s)

| Time | Phase |
|------|-------|
| 0-2s | Hook text fades in on blurred "before" image |
| 0.5-6s | Before image with slow Ken Burns zoom |
| 5.5-7s | Diagonal swipe transition + white flash |
| 6.5-12s | After image with slow pan, "Restored ✦" badge |
| 11.5-15s | EternalFrame CTA with pulsing button |

### Template B: Tips/Educational (15s)

| Time | Phase |
|------|-------|
| 0-3s | Hook question on dark gradient background |
| 2.5-10s | Tip card with title, body, optional image |
| 9.5-12.5s | Key takeaway with emphasis animation |
| 12-15s | EternalFrame CTA |

## Content Pipeline Status Flow

```
queued → scripted → rendering → rendered → posted
                                         ↘ failed
```

## Scheduling with n8n

1. Import the n8n workflow (see `n8n/` folder)
2. Or create a simple workflow:
   - **Trigger**: Cron — `0 10 * * 1,3,5` (Mon/Wed/Fri at 10am)
   - **Step 1**: HTTP Request — `GET /rest/v1/next_content_to_process` (Supabase view)
   - **Step 2**: Execute Command — `npx tsx scripts/render-video.ts <id>`
   - **Step 3**: Notify (Slack/Discord) with result

### Alternative: pg_cron (stays in Supabase)

```sql
-- Requires pg_cron extension
SELECT cron.schedule(
  'auto-tiktok-mwf',
  '0 10 * * 1,3,5',  -- Mon/Wed/Fri at 10am UTC
  $$SELECT net.http_post(
    'https://your-edge-function.supabase.co/functions/v1/render-tiktok',
    '{}',
    '{}'::jsonb
  )$$
);
```

## TikTok API Setup

1. Create a TikTok Developer account at https://developers.tiktok.com
2. Create an app and request `video.publish` scope
3. Complete app review (takes 1-2 weeks)
4. Generate access token via OAuth flow
5. Set `TIKTOK_ACCESS_TOKEN` in your environment

**Until API approval:** Videos render to `./output/` for manual upload via TikTok app.

## Monitoring

```sql
-- Check pipeline status
SELECT * FROM content_pipeline_stats;

-- See posted video performance
SELECT * FROM posted_video_performance;

-- Items stuck in rendering
SELECT * FROM tiktok_content_pool
WHERE status = 'rendering'
AND updated_at < now() - interval '1 hour';
```

## File Structure

```
auto-tiktok-engine/
├── package.json
├── src/
│   ├── index.ts                       # Remotion entry
│   ├── Root.tsx                       # Composition registry
│   ├── config.ts                      # Brand, timing, helpers
│   ├── compositions/
│   │   ├── BeforeAfterReveal.tsx      # Template A
│   │   └── TipsEducational.tsx        # Template B
│   └── components/
│       ├── EternalFrameCTA.tsx         # Branded CTA overlay
│       └── HookText.tsx               # Animated hook text
├── scripts/
│   ├── generate-script.ts             # Claude API script gen
│   └── render-video.ts                # Full pipeline orchestrator
├── supabase/
│   └── migration.sql                  # Content pool schema
└── output/                            # Rendered videos land here
```

## Customization

- **Brand colors**: Edit `BRAND` in `src/config.ts`
- **Video timing**: Edit `REVEAL_TIMING` / `TIPS_TIMING` in `src/config.ts`
- **Script voice**: Edit `SYSTEM_PROMPT` in `scripts/generate-script.ts`
- **Music**: Add royalty-free tracks to `public/` and seed `tiktok_music_library` table
- **CTA text**: Edit `src/components/EternalFrameCTA.tsx`
