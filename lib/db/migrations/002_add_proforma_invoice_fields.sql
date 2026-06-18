-- Migration: Add address line fields, GST percent fields to proforma_invoices
-- Run this manually if drizzle push is not used.

ALTER TABLE proforma_invoices ADD COLUMN IF NOT EXISTS address_line1 TEXT;
ALTER TABLE proforma_invoices ADD COLUMN IF NOT EXISTS address_line2 TEXT;
ALTER TABLE proforma_invoices ADD COLUMN IF NOT EXISTS address_line3 TEXT;
ALTER TABLE proforma_invoices ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE proforma_invoices ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE proforma_invoices ADD COLUMN IF NOT EXISTS pincode TEXT;
ALTER TABLE proforma_invoices ADD COLUMN IF NOT EXISTS cgst_percent NUMERIC(5,2) DEFAULT '0';
ALTER TABLE proforma_invoices ADD COLUMN IF NOT EXISTS sgst_percent NUMERIC(5,2) DEFAULT '0';
ALTER TABLE proforma_invoices ADD COLUMN IF NOT EXISTS igst_percent NUMERIC(5,2) DEFAULT '0';
