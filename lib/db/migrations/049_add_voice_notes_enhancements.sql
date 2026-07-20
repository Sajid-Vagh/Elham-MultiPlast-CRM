-- Voice Notes enhancements: add order_id, lead_id, customer_id, created_by_role, file_available
-- This enables voice notes to be linked to any entity across the CRM

ALTER TABLE voice_notes ADD COLUMN IF NOT EXISTS order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL;
ALTER TABLE voice_notes ADD COLUMN IF NOT EXISTS lead_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL;
ALTER TABLE voice_notes ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customer_master(id) ON DELETE SET NULL;
ALTER TABLE voice_notes ADD COLUMN IF NOT EXISTS created_by_role TEXT NOT NULL DEFAULT 'sales';
ALTER TABLE voice_notes ADD COLUMN IF NOT EXISTS file_available BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_voice_notes_order ON voice_notes(order_id);
CREATE INDEX IF NOT EXISTS idx_voice_notes_lead ON voice_notes(lead_id);
CREATE INDEX IF NOT EXISTS idx_voice_notes_customer ON voice_notes(customer_id);
CREATE INDEX IF NOT EXISTS idx_voice_notes_created_by_role ON voice_notes(created_by_role);
CREATE INDEX IF NOT EXISTS idx_voice_notes_file_available ON voice_notes(file_available);
