-- Customer Master table for saved GST customers
CREATE TABLE IF NOT EXISTS customer_master (
  id SERIAL PRIMARY KEY,
  company_name TEXT NOT NULL,
  trade_name TEXT,
  gstin TEXT NOT NULL UNIQUE,
  address_line1 TEXT,
  address_line2 TEXT,
  address_line3 TEXT,
  city TEXT,
  district TEXT,
  state TEXT,
  pincode TEXT,
  mobile TEXT,
  email TEXT,
  customer_type TEXT DEFAULT 'GST',
  gst_status TEXT DEFAULT 'Active',
  business_constitution TEXT,
  notes TEXT,
  linked_contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add new columns to proforma_invoices
ALTER TABLE proforma_invoices ADD COLUMN IF NOT EXISTS district TEXT;
ALTER TABLE proforma_invoices ADD COLUMN IF NOT EXISTS gst_status TEXT;
ALTER TABLE proforma_invoices ADD COLUMN IF NOT EXISTS trade_name TEXT;
ALTER TABLE proforma_invoices ADD COLUMN IF NOT EXISTS customer_master_id INTEGER REFERENCES customer_master(id) ON DELETE SET NULL;

-- Index for GSTIN lookup
CREATE INDEX IF NOT EXISTS idx_customer_master_gstin ON customer_master(gstin);
CREATE INDEX IF NOT EXISTS idx_proforma_invoices_customer_master_id ON proforma_invoices(customer_master_id);
