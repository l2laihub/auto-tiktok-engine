-- ============================================================
-- EternalFrame Auto-TikTok Engine — Migration v2
-- Multi-pair images + Suno AI music integration
-- ============================================================

-- Multi-pair image support (JSONB array of before/after pairs)
-- Expected shape: [{"before_url": "...", "after_url": "...", "era": "1960s", "label": "Grandma's wedding"}, ...]
ALTER TABLE tiktok_content_pool ADD COLUMN IF NOT EXISTS image_pairs JSONB;

-- Per-video audio volume override
ALTER TABLE tiktok_content_pool ADD COLUMN IF NOT EXISTS audio_volume REAL DEFAULT 0.6;

-- Suno AI music integration fields
ALTER TABLE tiktok_content_pool ADD COLUMN IF NOT EXISTS music_style TEXT;        -- Suno-compatible prompt (e.g. "warm nostalgic piano with gentle strings")
ALTER TABLE tiktok_content_pool ADD COLUMN IF NOT EXISTS suno_audio_url TEXT;     -- Suno CDN URL for generated track
ALTER TABLE tiktok_content_pool ADD COLUMN IF NOT EXISTS music_file_path TEXT;    -- local path to trimmed audio file

-- Constraint: 1-6 image pairs max
ALTER TABLE tiktok_content_pool ADD CONSTRAINT chk_image_pairs_length
  CHECK (image_pairs IS NULL OR jsonb_array_length(image_pairs) BETWEEN 1 AND 6);

-- Backfill existing single-pair rows into the new image_pairs column
UPDATE tiktok_content_pool
SET image_pairs = jsonb_build_array(
  jsonb_build_object(
    'before_url', before_image_url,
    'after_url', after_image_url,
    'era', photo_era
  )
)
WHERE before_image_url IS NOT NULL
  AND image_pairs IS NULL;

-- Update music library table comment to reflect Suno integration
COMMENT ON TABLE tiktok_music_library IS 'Music tracks for video soundtracks. Includes both royalty-free library tracks and Suno AI-generated tracks cached for reuse.';

-- Add source tracking for Suno-generated tracks in music library
ALTER TABLE tiktok_music_library ADD COLUMN IF NOT EXISTS suno_id TEXT;           -- Suno generation ID for provenance
ALTER TABLE tiktok_music_library ADD COLUMN IF NOT EXISTS audio_url TEXT;         -- Original Suno CDN URL
ALTER TABLE tiktok_music_library ADD COLUMN IF NOT EXISTS prompt TEXT;            -- Suno generation prompt used
