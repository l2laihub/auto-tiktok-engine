-- ============================================================
-- EternalFrame Auto-TikTok Engine — Migration v3
-- Tip video visual enhancements (AI imagery + icon accent)
-- ============================================================
-- The `reveal` self-sourcing feature reuses the existing image_pairs
-- column (migration-v2.sql) — no schema change needed there.
-- Generated reveal images are stored in the existing `photos` bucket
-- under the `generated/reveal/` prefix.

-- B-roll montage: array of public image URLs shown behind a tip card.
ALTER TABLE tiktok_content_pool ADD COLUMN IF NOT EXISTS tip_images JSONB;

-- Single emoji used as the tip's icon accent chip (chosen during scripting).
ALTER TABLE tiktok_content_pool ADD COLUMN IF NOT EXISTS tip_icon TEXT;

COMMENT ON COLUMN tiktok_content_pool.tip_images IS 'JSON array of public image URLs (b-roll) shown behind the tip card. tip_image_url is the primary background.';
COMMENT ON COLUMN tiktok_content_pool.tip_icon IS 'Emoji icon accent for the tip card, e.g. "🖼️".';
