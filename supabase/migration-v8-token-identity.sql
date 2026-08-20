-- Migration v8: Store the TikTok profile behind each token row
-- The tiktok_tokens.id is a local label chosen by the operator ('nk-nails');
-- it says nothing about which TikTok account consented. These columns record
-- the profile the tokens actually belong to so the dashboard can show it.

ALTER TABLE tiktok_tokens
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS username TEXT;

COMMENT ON COLUMN tiktok_tokens.display_name IS 'TikTok profile display name at authorization time';
COMMENT ON COLUMN tiktok_tokens.username IS 'TikTok @handle (unique) the tokens belong to';
