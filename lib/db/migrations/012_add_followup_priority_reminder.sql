ALTER TABLE activities ADD COLUMN IF NOT EXISTS priority text DEFAULT 'Medium';
ALTER TABLE activities ADD COLUMN IF NOT EXISTS reminder text;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS assigned_to integer REFERENCES users(id);
