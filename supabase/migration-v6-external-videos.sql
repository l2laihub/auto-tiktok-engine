-- Migration v6: External videos (studio-ops renders) scheduled to client TikTok accounts
--
-- External items are born rendered: status='rendered' + video_url + scheduled_for.
-- The existing scheduler and post-only path handle them with no new machinery.
--
-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block; run this
-- file as-is in the Supabase SQL editor (it executes statements individually).

ALTER TYPE content_type ADD VALUE IF NOT EXISTS 'external';

-- Which tiktok_tokens row posts this item. NULL = 'default' (@huybuilds).
ALTER TABLE tiktok_content_pool ADD COLUMN IF NOT EXISTS tiktok_account TEXT;

COMMENT ON COLUMN tiktok_content_pool.tiktok_account IS
  'tiktok_tokens.id to post with. NULL = default (@huybuilds). Client accounts get their own token row via: npm run tiktok:setup -- --account <name>';
COMMENT ON TABLE tiktok_tokens IS
  'Per-account OAuth token storage keyed by id (''default'' = @huybuilds, others = client accounts).';
