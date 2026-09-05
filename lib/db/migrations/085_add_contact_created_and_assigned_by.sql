-- Migration 085: Add created_by_id and assigned_by_id to contacts table for assignment tracking
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS created_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS assigned_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_created_by_id ON contacts(created_by_id);
CREATE INDEX IF NOT EXISTS idx_contacts_assigned_by_id ON contacts(assigned_by_id);

-- Backfill from notifications where available
UPDATE contacts c
SET created_by_id = n.created_by_id,
    assigned_by_id = n.created_by_id
FROM notifications n
WHERE n.related_id = c.id
  AND n.related_type = 'contact'
  AND n.type IN ('assignment', 'enquiry_assigned')
  AND n.created_by_id IS NOT NULL
  AND c.created_by_id IS NULL;

-- For any remaining rows, default to sales_owner_id (self-assigned)
UPDATE contacts
SET created_by_id = sales_owner_id,
    assigned_by_id = sales_owner_id
WHERE created_by_id IS NULL;
