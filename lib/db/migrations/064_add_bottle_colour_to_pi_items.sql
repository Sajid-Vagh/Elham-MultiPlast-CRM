-- Add bottle_colour column to proforma_invoice_items table
-- This stores the exact bottle colour variant chosen by the sales person at PI creation time,
-- which propagates through to production_order_items for correct display on Production Dashboard.

ALTER TABLE proforma_invoice_items ADD COLUMN IF NOT EXISTS bottle_colour text;
