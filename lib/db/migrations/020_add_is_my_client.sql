ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_my_client BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE contacts SET is_my_client = TRUE WHERE id IN (
  SELECT DISTINCT contact_id FROM deals WHERE stage = 'Won'
);

CREATE INDEX IF NOT EXISTS idx_contacts_is_my_client ON contacts(is_my_client);
