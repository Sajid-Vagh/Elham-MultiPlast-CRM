ALTER TABLE proforma_invoices ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE proforma_invoices ADD COLUMN IF NOT EXISTS deleted_by integer REFERENCES users(id) ON DELETE SET NULL;
