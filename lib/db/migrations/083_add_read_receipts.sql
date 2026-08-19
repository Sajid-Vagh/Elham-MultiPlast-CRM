-- Migration 083: Add readBy tracking to production_messages and voice_notes
-- production_messages.readBy: which users have seen each chat message
-- voice_notes.readBy: which users have listened to/viewed each voice note

ALTER TABLE production_messages
  ADD COLUMN IF NOT EXISTS read_by integer[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_production_messages_read_by ON production_messages USING gin (read_by);

ALTER TABLE voice_notes
  ADD COLUMN IF NOT EXISTS read_by integer[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_voice_notes_read_by ON voice_notes USING gin (read_by);
