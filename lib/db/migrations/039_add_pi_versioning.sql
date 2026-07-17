-- Migration: Add PI versioning, active flag, and revision reason
-- Supports: multiple PI versions per deal, only one active at a time

ALTER TABLE proforma_invoices ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE proforma_invoices ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE proforma_invoices ADD COLUMN IF NOT EXISTS revision_reason text;

-- Performance index for "find active PI for deal" queries
CREATE INDEX IF NOT EXISTS idx_proforma_invoices_deal_active ON proforma_invoices(deal_id, is_active) WHERE is_deleted = false;
