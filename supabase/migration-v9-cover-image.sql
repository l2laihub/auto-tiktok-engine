-- Migration v9: optional cover image for scheduled external videos.
--
-- TikTok's Content Posting API can't take a custom cover image (Direct Post only
-- accepts a frame timestamp; Inbox Upload accepts none), so this URL is sent with
-- the Telegram inbox ping for setting the cover by hand in the TikTok app.

ALTER TABLE tiktok_content_pool ADD COLUMN IF NOT EXISTS cover_image_url TEXT;
