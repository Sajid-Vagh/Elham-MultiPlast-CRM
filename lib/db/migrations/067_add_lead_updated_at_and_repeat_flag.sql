-- Add updated_at timestamp to contacts for "recent activity" sorting.
-- Repeat enquiries bump this timestamp so the lead jumps to the top of the Leads list.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Backfill existing rows with their created_at value so pre-existing leads keep a sensible order.
-- (ADD COLUMN DEFAULT now() backfilled with the ALTER-time clock, so unconditional overwrite is needed.)
UPDATE contacts SET updated_at = created_at WHERE created_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_updated_at ON contacts (updated_at DESC);

-- Track repeat enquiries so the unread dot can be colour-coded (yellow for repeat, blue for new assignment).
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_repeat_enquiry BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_contacts_is_repeat_enquiry ON contacts (is_repeat_enquiry);
