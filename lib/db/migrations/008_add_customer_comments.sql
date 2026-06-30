-- Add customer comments fields to contacts table
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS customer_comments TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS comment_updated_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS comment_updated_by INTEGER REFERENCES users(id);

-- Create comment_history table
CREATE TABLE IF NOT EXISTS comment_history (
  id SERIAL PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  comment TEXT NOT NULL,
  updated_by INTEGER NOT NULL REFERENCES users(id),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
