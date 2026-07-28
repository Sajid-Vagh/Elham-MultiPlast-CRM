-- Migration 057: Add file_data column to voice_notes for direct DB storage
-- This replaces Supabase Storage as the audio file backend, fixing the
-- "sb_publishable_" key incompatibility with the Supabase Storage REST API.

ALTER TABLE voice_notes ADD COLUMN file_data bytea;

-- Add index for faster existence checks (skip for small tables, but good practice)
-- No index on bytea itself (too large), but we can use file_data IS NOT NULL
-- for quick availability checks.
CREATE INDEX idx_voice_notes_has_file_data ON voice_notes (id) WHERE file_data IS NOT NULL;
