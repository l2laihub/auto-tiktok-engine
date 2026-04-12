-- ============================================================
-- EternalFrame Auto-TikTok Engine — Dashboard Migration
-- ============================================================
-- Adds pipeline run history tracking for the dashboard.
-- ============================================================

CREATE TABLE pipeline_run_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  content_id    UUID REFERENCES tiktok_content_pool(id) ON DELETE SET NULL,
  dry_run       BOOLEAN NOT NULL DEFAULT false,
  success       BOOLEAN,
  output        TEXT,
  error         TEXT
);

CREATE INDEX idx_pipeline_run_log_started
  ON pipeline_run_log (started_at DESC);

COMMENT ON TABLE pipeline_run_log IS 'Log of pipeline execution runs for dashboard monitoring.';
