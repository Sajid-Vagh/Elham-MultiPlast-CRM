-- Phase 1: Sales Workflow Redesign
-- Add deal_id to orders and production_orders for atomic Deal Won → Order creation
-- Make proforma_invoice_id nullable on production_orders (some deals have no PI)

-- 1. Add deal_id to orders table
ALTER TABLE orders ADD COLUMN deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL;
CREATE INDEX idx_orders_deal_id ON orders(deal_id);

-- 2. Add deal_id to production_orders table
ALTER TABLE production_orders ADD COLUMN deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL;
CREATE INDEX idx_production_orders_deal_id ON production_orders(deal_id);

-- 3. Make proforma_invoice_id nullable on production_orders (was NOT NULL + UNIQUE)
ALTER TABLE production_orders ALTER COLUMN proforma_invoice_id DROP NOT NULL;
ALTER TABLE production_orders DROP CONSTRAINT IF EXISTS production_orders_proforma_invoice_id_unique;
