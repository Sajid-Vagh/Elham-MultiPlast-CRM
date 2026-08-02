-- Migration 069: Support automated voice-note storage cleanup.
--
-- Background:
--   A daily cron job purges the physical audio files of voice notes attached to
--   orders that were marked 'Delivered' or 'Completed' more than 90 days ago.
--   The voice_notes ROW must survive (historical record + transcript remain),
--   but the audio bytes can be freed.
--
-- Changes:
--   1. storage_path becomes nullable so it can be cleared after the file is gone.
--   2. file_deleted_at records when the audio was auto-purged (NULL = still available).
--   3. Indexes to make the daily cleanup query fast.

ALTER TABLE voice_notes ALTER COLUMN storage_path DROP NOT NULL;

ALTER TABLE voice_notes ADD COLUMN file_deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_voice_notes_order_id
  ON voice_notes (order_id)
  WHERE file_deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_status_updated_at
  ON orders (status, updated_at);
