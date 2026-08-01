-- Unread lead indicator: tracks whether a sales owner has viewed a lead.
-- New leads default to unread (false). Reassignment resets the flag to false.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_read BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_contacts_is_read ON contacts(is_read);
