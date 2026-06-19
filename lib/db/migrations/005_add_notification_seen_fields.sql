ALTER TABLE notifications ADD COLUMN IF NOT EXISTS notification_seen BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS notification_seen_at TIMESTAMPTZ;
