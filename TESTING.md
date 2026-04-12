# End-to-End Testing Guide

Walk through each stage of the pipeline to verify everything works.

## Prerequisites

```bash
# 1. Ensure dependencies are installed
npm install

# 2. Verify your .env has these filled in:
#    SUPABASE_URL=https://vdvkelwqwaynpqrpynjf.supabase.co
#    SUPABASE_SERVICE_ROLE_KEY=<your key>
#    ANTHROPIC_API_KEY=<your key>
#    TIKTOK_ACCESS_TOKEN=        (leave blank — we'll use dry-run)
#    OUTPUT_DIR=./output

# 3. Verify the migration has been deployed
npx supabase db query --linked "SELECT tablename FROM pg_tables WHERE schemaname = 'public';"
# Expected: tiktok_content_pool, tiktok_music_library
```

---

## Stage 1: Remotion Studio Preview

Verify both video templates render correctly in the browser.

```bash
npm run studio
```

**What to check:**
- Browser opens at http://localhost:3000
- Left sidebar shows two compositions: `BeforeAfterReveal` and `TipsEducational`
- Click `BeforeAfterReveal` — scrub through the timeline and verify:
  - 0–2s: Hook text fades in over a blurred placeholder image
  - 0.5–6s: "Before" image with slow zoom, "Before" label top-left
  - 5.5–7s: Diagonal swipe transition with white flash
  - 6.5–12s: "After" image with pan, "Restored ✦" badge in teal
  - 11.5–15s: EternalFrame CTA with pulsing button
- Click `TipsEducational` — scrub through and verify:
  - 0–3s: Hook question text on dark gradient
  - 2.5–10s: Tip card slides up with title, body, accent bar
  - 9.5–12.5s: Takeaway card with lightning emoji
  - 12–15s: EternalFrame CTA
- Both templates should be 1080×1920, 15 seconds, 30fps

**Stop here if:** Studio doesn't start or templates don't render. Check terminal for errors.

Press `Ctrl+C` to stop Studio before continuing.

---

## Stage 2: Render a Preview Video

Verify Remotion can render an actual MP4 file.

```bash
npm run render:reveal
```

**What to check:**
- Terminal shows bundling progress, then rendering frames
- File created at `output/reveal-preview.mp4`
- Open the MP4 — it should match what you saw in Studio
- File size should be roughly 2–5 MB for a 15s video

```bash
npm run render:tips
```

**What to check:**
- File created at `output/tips-preview.mp4`
- Open and verify it matches the Tips template from Studio

**Stop here if:** Rendering fails. Common issues:
- Missing `ffmpeg` — install via `sudo apt install ffmpeg` or `brew install ffmpeg`
- Out of memory — close other apps, Remotion rendering is memory-intensive

---

## Stage 3: AI Script Generation (Demo Mode)

Verify Claude API generates valid scripts.

```bash
npm run generate-script
```

**What to check:**
- Terminal prints "No content ID provided. Running demo..."
- Two JSON blocks are printed: one for a reveal, one for a tip
- Each JSON has: `hook_text`, `caption`, `hashtags`, `music_mood`
- The tip JSON also has `takeaway`
- `hook_text` is under ~60 characters
- `caption` is 150–300 characters
- `hashtags` is an array of 5–8 strings
- `music_mood` is one of: emotional, nostalgic, inspiring, upbeat

Example expected output:
```json
{
  "hook_text": "She thought this photo\nwas lost forever",
  "caption": "My grandmother's wedding photo from 1962 sat in a water-damaged album for decades. The faces were nearly gone. One AI restoration later, she's seeing her wedding day in color for the first time.",
  "hashtags": ["photorestoration", "familymemories", "oldphotos", "vietnamesefamily", "airestore", "vintagephotos"],
  "music_mood": "emotional"
}
```

**Stop here if:** API call fails. Check that `ANTHROPIC_API_KEY` is set correctly in `.env`.

---

## Stage 4: Seed Test Content in Supabase

Insert a test "reveal" item into the content pool.

```bash
npx supabase db query --linked "$(cat <<'SQL'
INSERT INTO tiktok_content_pool (
  content_type,
  before_image_url,
  after_image_url,
  photo_era,
  photo_story,
  preset_used,
  scheduled_for
) VALUES (
  'reveal',
  'https://placehold.co/1080x1920/333/666?text=Before',
  'https://placehold.co/1080x1920/667/999?text=After',
  '1960s',
  'Wedding photo of Vietnamese grandparents, found in water-damaged album',
  'vintage-colorize',
  CURRENT_DATE
) RETURNING id, status;
SQL
)"
```

**What to check:**
- Returns a UUID `id` and status `queued`
- **Save the returned `id`** — you'll need it in the next steps

Insert a test "tip" item too:

```bash
npx supabase db query --linked "$(cat <<'SQL'
INSERT INTO tiktok_content_pool (
  content_type,
  tip_title,
  tip_body,
  tip_source,
  scheduled_for
) VALUES (
  'tip',
  'Why AI faces look wrong in restored photos',
  'Most AI models distort facial features during restoration. After 100+ prompt iterations, we found that explicit identity anchoring reduces face drift by 73%.',
  'EternalFrame autoresearch',
  CURRENT_DATE
) RETURNING id, status;
SQL
)"
```

**Verify both items are queued:**

```bash
npx supabase db query --linked "SELECT id, content_type, status, scheduled_for FROM tiktok_content_pool ORDER BY created_at;"
```

---

## Stage 5: Script Generation with Real Content

Test that `generate-script.ts` can fetch from Supabase and generate a script.

```bash
npx tsx scripts/generate-script.ts <reveal-id-from-stage-4>
```

**What to check:**
- Terminal prints "Fetching content ID: ..."
- Prints "Generating script for reveal item..."
- Prints the generated JSON (same format as Stage 3)
- Prints "Row updated to status: scripted"

**Verify the row was updated in Supabase:**

```bash
npx supabase db query --linked "SELECT id, status, hook_text, caption FROM tiktok_content_pool WHERE status = 'scripted';"
```

- The reveal item should now have status `scripted` with `hook_text` and `caption` populated

---

## Stage 6: Full Pipeline — Dry Run

This is the big test. Run the full pipeline on the tip item (which is still `queued`).

```bash
npm run pipeline:dry
```

**What to check step by step:**

1. **Step 1 — Fetching content:** Should pick up the tip item (next queued item)
2. **Step 2 — Script generation:** Should generate a script and update Supabase
3. **Step 3 — Video rendering:** Should bundle Remotion, render `TipsEducational` composition
4. **Step 4 — Uploading video:** Should upload to Supabase Storage
5. **Step 5 — Posting:** Should print `[DRY RUN] Skipping TikTok post` with caption and hashtags
6. **Pipeline complete!** message at the end

**Verify the rendered video:**
- Check `output/` directory for a file named `tip-<id-prefix>.mp4`
- Open it — should be a 15s tips video with the AI-generated hook text

**Verify Supabase state:**

```bash
npx supabase db query --linked "SELECT id, content_type, status, hook_text, video_url FROM tiktok_content_pool ORDER BY updated_at DESC;"
```

- Tip item: status should be `rendered`, `video_url` should be populated
- Reveal item: status should be `scripted` (from Stage 5)

**Verify the pipeline stats view:**

```bash
npx supabase db query --linked "SELECT * FROM content_pipeline_stats;"
```

- Should show counts by status and content_type

---

## Stage 7: Pipeline with Specific ID

Run the pipeline on the reveal item we scripted in Stage 5.

```bash
npx tsx scripts/render-video.ts --dry-run <reveal-id-from-stage-4>
```

**What to check:**
- Skips script generation ("Script already exists")
- Renders `BeforeAfterReveal` composition
- Uploads to Supabase Storage
- Dry-run skips TikTok posting
- Reveal video appears in `output/`

---

## Stage 8: Verify Final State

Check that everything is consistent.

```bash
# All items should be 'rendered'
npx supabase db query --linked "SELECT id, content_type, status, video_url, hook_text FROM tiktok_content_pool;"

# Pipeline stats
npx supabase db query --linked "SELECT * FROM content_pipeline_stats;"

# Videos in storage
npx supabase db query --linked "SELECT id, content_type, video_url FROM tiktok_content_pool WHERE video_url IS NOT NULL;"
```

**Expected final state:**
| content_type | status   | hook_text | video_url |
|-------------|----------|-----------|-----------|
| reveal      | rendered | populated | populated |
| tip         | rendered | populated | populated |

---

## Cleanup (Optional)

Remove test data when done:

```bash
npx supabase db query --linked "DELETE FROM tiktok_content_pool WHERE photo_story LIKE '%water-damaged%' OR tip_title LIKE '%AI faces%';"
```

Remove rendered test videos:
```bash
rm -f output/*.mp4
```

---

## What's Not Tested Yet

These are documented as phase-2 items:

- **Music resolution:** `music_mood` is stored but not resolved to an actual audio file from `tiktok_music_library`. Videos render without background music.
- **TikTok posting:** The TikTok API integration only implements the init step. Full posting requires completing the upload+publish flow and a valid `TIKTOK_ACCESS_TOKEN`.
- **Scheduling:** n8n or pg_cron triggers are not set up yet. The pipeline runs on-demand only.
