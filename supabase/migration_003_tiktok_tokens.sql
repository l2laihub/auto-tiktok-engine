-- Migration 003: TikTok OAuth Token Storage & Publish Status Tracking
-- Single-row token table for the @huybuilds account

-- Token storage for OAuth lifecycle management
CREATE TABLE IF NOT EXISTS tiktok_tokens (
  id            TEXT PRIMARY KEY DEFAULT 'default',
  access_token  TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  scope         TEXT,
  open_id       TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Track TikTok's async video processing status separately from pipeline status
ALTER TABLE tiktok_content_pool
  ADD COLUMN IF NOT EXISTS publish_status TEXT;

COMMENT ON COLUMN tiktok_content_pool.publish_status IS 'TikTok async processing status: processing, published, publish_failed';
COMMENT ON TABLE tiktok_tokens IS 'Single-row OAuth token storage for @huybuilds TikTok account';
