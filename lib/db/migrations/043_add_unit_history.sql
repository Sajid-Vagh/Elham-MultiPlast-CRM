-- Unit history table: tracks every unit change with old/new value, reason, user, and timestamp
-- Follows the same pattern as category_history (migration 009)

CREATE TABLE IF NOT EXISTS unit_history (
  id SERIAL PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  previous_unit TEXT,
  new_unit TEXT,
  changed_by INTEGER NOT NULL REFERENCES users(id),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_unit_history_contact ON unit_history(contact_id);
CREATE INDEX IF NOT EXISTS idx_unit_history_created ON unit_history(created_at DESC);
