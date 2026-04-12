-- ============================================================
-- EternalFrame Auto-TikTok Engine — Content Pool Schema
-- ============================================================
-- Run this migration in your shared EternalFrame/DaPortrait
-- Supabase project.
-- ============================================================

-- Content type enum
CREATE TYPE content_type AS ENUM ('reveal', 'tip');

-- Content status lifecycle: queued → scripted → rendering → rendered → posted → failed
CREATE TYPE content_status AS ENUM (
  'queued',      -- raw content waiting for script generation
  'scripted',    -- AI script generated, ready to render
  'rendering',   -- video render in progress
  'rendered',    -- video file ready, awaiting post
  'posted',      -- successfully posted to TikTok
  'failed'       -- something broke, needs attention
);

-- Main content pool table
CREATE TABLE tiktok_content_pool (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  scheduled_for DATE,                        -- target publish date (nullable for unscheduled)

  -- Content type & status
  content_type  content_type NOT NULL,
  status        content_status NOT NULL DEFAULT 'queued',

  -- === REVEAL-specific fields ===
  before_image_url  TEXT,                    -- Supabase Storage URL for degraded photo
  after_image_url   TEXT,                    -- Supabase Storage URL for restored photo
  preset_used       TEXT,                    -- EternalFrame preset (e.g. 'vintage-colorize')
  photo_era         TEXT,                    -- e.g. '1960s', '1940s'
  photo_story       TEXT,                    -- brief context for AI script gen

  -- === TIP-specific fields ===
  tip_title         TEXT,                    -- tip headline
  tip_body          TEXT,                    -- tip explanation
  tip_image_url     TEXT,                    -- optional supporting image
  tip_source        TEXT,                    -- where the tip came from (autoresearch, blog, etc.)

  -- === AI-generated script (populated by script gen step) ===
  hook_text         TEXT,                    -- first 1-2 seconds text overlay
  caption           TEXT,                    -- TikTok post caption
  hashtags          TEXT[],                  -- array of hashtags
  music_track       TEXT,                    -- filename from royalty-free library

  -- === Render output ===
  video_url         TEXT,                    -- rendered video file URL
  video_duration_ms INTEGER,                 -- video duration in milliseconds
  thumbnail_url     TEXT,                    -- auto-generated thumbnail

  -- === TikTok posting ===
  tiktok_post_id    TEXT,                    -- returned by TikTok API after posting
  posted_at         TIMESTAMPTZ,
  post_error        TEXT,                    -- error message if failed

  -- === Analytics (populated later) ===
  views             INTEGER DEFAULT 0,
  likes             INTEGER DEFAULT 0,
  shares            INTEGER DEFAULT 0,
  comments          INTEGER DEFAULT 0
);

-- Index for the scheduler to pick next queued item
CREATE INDEX idx_content_pool_status_scheduled
  ON tiktok_content_pool (status, scheduled_for)
  WHERE status IN ('queued', 'scripted', 'rendered');

-- Index for analytics queries
CREATE INDEX idx_content_pool_posted
  ON tiktok_content_pool (posted_at DESC)
  WHERE status = 'posted';

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_content_pool_updated_at
  BEFORE UPDATE ON tiktok_content_pool
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- Music library table (royalty-free tracks)
-- ============================================================
CREATE TABLE tiktok_music_library (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename    TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  mood        TEXT NOT NULL,          -- 'emotional', 'upbeat', 'nostalgic', 'inspiring'
  duration_ms INTEGER NOT NULL,
  bpm         INTEGER,
  source      TEXT,                   -- where you got the track
  license     TEXT                    -- license type
);

-- Seed some mood categories for matching
COMMENT ON TABLE tiktok_content_pool IS 'Content queue for the Auto-TikTok Engine. Each row = one potential TikTok video.';
COMMENT ON TABLE tiktok_music_library IS 'Royalty-free music tracks categorized by mood for video soundtracks.';

-- ============================================================
-- Helper views
-- ============================================================

-- Next item to process (picks oldest queued item with a scheduled date <= today)
CREATE VIEW next_content_to_process AS
  SELECT *
  FROM tiktok_content_pool
  WHERE status = 'queued'
    AND (scheduled_for IS NULL OR scheduled_for <= CURRENT_DATE)
  ORDER BY scheduled_for ASC NULLS LAST, created_at ASC
  LIMIT 1;

-- Dashboard: content pipeline overview
CREATE VIEW content_pipeline_stats AS
  SELECT
    status,
    content_type,
    COUNT(*) AS count
  FROM tiktok_content_pool
  GROUP BY status, content_type
  ORDER BY status, content_type;

-- Posted videos with performance
CREATE VIEW posted_video_performance AS
  SELECT
    id,
    content_type,
    hook_text,
    posted_at,
    views,
    likes,
    shares,
    comments,
    CASE WHEN views > 0 THEN ROUND(likes::numeric / views * 100, 2) ELSE 0 END AS engagement_rate
  FROM tiktok_content_pool
  WHERE status = 'posted'
  ORDER BY posted_at DESC;

-- ============================================================
-- Storage bucket for rendered videos
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('videos', 'videos', true)
ON CONFLICT (id) DO NOTHING;

-- Storage bucket for uploaded photos (before/after)
INSERT INTO storage.buckets (id, name, public)
VALUES ('photos', 'photos', true)
ON CONFLICT (id) DO NOTHING;
