-- Migration: Add customer type and ID proof fields to proforma_invoices
-- Run this manually if drizzle push is not used.

ALTER TABLE proforma_invoices ADD COLUMN IF NOT EXISTS customer_type TEXT NOT NULL DEFAULT 'GST';
ALTER TABLE proforma_invoices ADD COLUMN IF NOT EXISTS id_proof_type TEXT;
ALTER TABLE proforma_invoices ADD COLUMN IF NOT EXISTS id_proof_number TEXT;
