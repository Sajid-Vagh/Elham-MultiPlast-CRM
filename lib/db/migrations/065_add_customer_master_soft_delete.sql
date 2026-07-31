-- Soft-delete support for customer_master profiles.
-- Profiles are referenced by proforma_invoices.customer_master_id and voice_notes.customer_id,
-- so we soft-delete instead of hard-deleting (historical invoices keep their profile link).

ALTER TABLE customer_master ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE customer_master ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE customer_master ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_customer_master_is_deleted ON customer_master(is_deleted);
