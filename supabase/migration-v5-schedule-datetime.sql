-- migration-v5-schedule-datetime.sql
-- Per-item date+time scheduling: scheduled_for DATE -> TIMESTAMPTZ.
-- Existing date-only rows become 06:00 America/Los_Angeles on that date.
-- Idempotent: safe to re-run.

-- 1. The helper view depends on scheduled_for; drop it before altering the type.
DROP VIEW IF EXISTS next_content_to_process;

-- 2. Change the column type (only runs while still a DATE, so re-runs are no-ops).
DO $$
BEGIN
  IF (
    SELECT data_type FROM information_schema.columns
    WHERE table_name = 'tiktok_content_pool' AND column_name = 'scheduled_for'
  ) = 'date' THEN
    ALTER TABLE tiktok_content_pool
      ALTER COLUMN scheduled_for TYPE TIMESTAMPTZ
      USING (scheduled_for + TIME '06:00' AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- 3. Recreate the view, comparing against the current instant instead of date.
CREATE VIEW next_content_to_process AS
  SELECT *
  FROM tiktok_content_pool
  WHERE status = 'queued'
    AND (scheduled_for IS NULL OR scheduled_for <= now())
  ORDER BY scheduled_for ASC NULLS LAST, created_at ASC
  LIMIT 1;
