-- migration-v6-generation-meta.sql
-- Persist the input "recipe" behind each AI-generated item so winners can be
-- traced (via tiktok_post_id) and iterated on. Shape:
--   { "hint": "...", "damageNotes": "...", "source": "curated|ai|manual" }
-- Nullable; absent for hand-added / legacy items. damageNotes is null for tips.

ALTER TABLE tiktok_content_pool
  ADD COLUMN IF NOT EXISTS generation_meta JSONB;
