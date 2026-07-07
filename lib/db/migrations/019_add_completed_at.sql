ALTER TABLE deals ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_deals_completed_at ON deals(completed_at);
