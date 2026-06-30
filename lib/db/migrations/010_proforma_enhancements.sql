-- Proforma Invoice Enhancements for Phase 6
-- Add customer/deal linking, soft delete, per-item details, Expired status

ALTER TABLE proforma_invoices ADD COLUMN IF NOT EXISTS contact_id integer REFERENCES contacts(id) ON DELETE SET NULL;
ALTER TABLE proforma_invoices ADD COLUMN IF NOT EXISTS deal_id integer REFERENCES deals(id) ON DELETE SET NULL;
ALTER TABLE proforma_invoices ADD COLUMN IF NOT EXISTS sales_owner_id integer REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE proforma_invoices ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;

ALTER TABLE proforma_invoice_items ADD COLUMN IF NOT EXISTS bottle_type text;
ALTER TABLE proforma_invoice_items ADD COLUMN IF NOT EXISTS capacity text;
ALTER TABLE proforma_invoice_items ADD COLUMN IF NOT EXISTS weight text;
ALTER TABLE proforma_invoice_items ADD COLUMN IF NOT EXISTS discount_percent numeric(5,2) DEFAULT '0';
ALTER TABLE proforma_invoice_items ADD COLUMN IF NOT EXISTS discount numeric(14,2) DEFAULT '0';
ALTER TABLE proforma_invoice_items ADD COLUMN IF NOT EXISTS gst_percent numeric(5,2) DEFAULT '0';

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_proforma_invoices_contact_id ON proforma_invoices(contact_id);
CREATE INDEX IF NOT EXISTS idx_proforma_invoices_deal_id ON proforma_invoices(deal_id);
CREATE INDEX IF NOT EXISTS idx_proforma_invoices_sales_owner_id ON proforma_invoices(sales_owner_id);
CREATE INDEX IF NOT EXISTS idx_proforma_invoices_is_deleted ON proforma_invoices(is_deleted);
CREATE INDEX IF NOT EXISTS idx_proforma_invoices_status ON proforma_invoices(status);
CREATE INDEX IF NOT EXISTS idx_proforma_invoices_invoice_number ON proforma_invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_proforma_invoices_created_at ON proforma_invoices(created_at);
CREATE INDEX IF NOT EXISTS idx_proforma_invoice_items_invoice_id ON proforma_invoice_items(invoice_id);
