-- Create category_history table (if not already exists from earlier migrations)
CREATE TABLE IF NOT EXISTS category_history (
  id SERIAL PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  previous_category TEXT,
  new_category TEXT NOT NULL,
  changed_by INTEGER NOT NULL REFERENCES users(id),
  reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Add state column if missing (migration 004 safeguard)
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS state TEXT;
