-- Hide-from-timeline flag for deals.
-- Purely presentational: hidden deals stay fully functional in the database,
-- pipeline, reports and exports; they are only filtered out of the lead
-- detail page's Activity Timeline UI.
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS is_hidden_from_timeline BOOLEAN NOT NULL DEFAULT FALSE;
