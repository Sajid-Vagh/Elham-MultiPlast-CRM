-- Migration: Add follow-up time, call status, and notification status to activities table
-- Run this manually if drizzle push is not used.

ALTER TABLE activities ADD COLUMN IF NOT EXISTS follow_up_time TEXT;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS call_status TEXT DEFAULT 'Pending';
ALTER TABLE activities ADD COLUMN IF NOT EXISTS notification_status TEXT DEFAULT 'none';

-- Update existing activities to have default values
UPDATE activities SET call_status = 'Pending' WHERE call_status IS NULL;
UPDATE activities SET notification_status = 'none' WHERE notification_status IS NULL;
