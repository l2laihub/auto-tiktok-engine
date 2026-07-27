-- Migration v7: cross-process claim for the scheduler.
--
-- pipelineRunning (dashboard/server.ts) is an in-process flag, so two running
-- instances both select the same due row and both post it. claimed_at makes
-- pickup atomic: a conditional UPDATE that only one instance can win.
--
-- Deliberately NOT a new status value — ensureScript and the post-only
-- short-circuit in render-video.ts both branch on status, and overwriting it
-- would break them.

ALTER TABLE tiktok_content_pool ADD COLUMN claimed_at TIMESTAMPTZ;

COMMENT ON COLUMN tiktok_content_pool.claimed_at IS
  'When a pipeline run took ownership. NULL = unclaimed. A claim older than '
  'CLAIM_TTL_MS (30 min, scripts/lib/claim.ts) is treated as abandoned by a '
  'crashed run and may be re-claimed. Never released explicitly.';

-- The scheduler now filters on claimed_at too, so it joins the covering index.
DROP INDEX IF EXISTS idx_content_pool_status_scheduled;
CREATE INDEX idx_content_pool_status_scheduled
  ON tiktok_content_pool (status, scheduled_for, claimed_at)
  WHERE status IN ('queued', 'scripted', 'rendered');
