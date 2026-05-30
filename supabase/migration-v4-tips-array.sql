-- ============================================================
-- Migration v4: multi-tip support
-- Adds a `tips` JSONB array so a single `tip` content item can hold
-- several tips (the TipsEducational composition already renders an array).
-- When `tips` is NULL, the renderer/pipeline falls back to the legacy
-- single-tip columns (tip_title, tip_body, tip_icon, tip_image_url, tip_images).
-- ============================================================

ALTER TABLE tiktok_content_pool ADD COLUMN IF NOT EXISTS tips JSONB;

-- Optional length guard (1–6 tips), mirroring the image_pairs constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_tips_length'
  ) THEN
    ALTER TABLE tiktok_content_pool
      ADD CONSTRAINT chk_tips_length
      CHECK (tips IS NULL OR jsonb_array_length(tips) BETWEEN 1 AND 6);
  END IF;
END $$;

COMMENT ON COLUMN tiktok_content_pool.tips IS
  'JSON array of tip objects (camelCase to match the Remotion TipItem): '
  '{tipTitle, tipBody, tipIcon?, tipImageSrc?, tipImages?}. 1-6 elements. '
  'NULL means use the legacy single-tip columns.';
