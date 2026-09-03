-- Add call_not_received boolean column to contacts table.
-- Used to track unresponsive leads with visual highlighting and quick filtering.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS call_not_received BOOLEAN NOT NULL DEFAULT FALSE;
