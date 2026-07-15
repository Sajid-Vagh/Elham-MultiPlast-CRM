-- Migration 034: Dispatch Bridge + Role Rename
-- 1. Add production_order_id to dispatch table and make order_id nullable
-- 2. Rename roles: production_manager → production, support → production_and_support

-- Make orderId nullable and add productionOrderId
ALTER TABLE dispatch ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE dispatch ADD COLUMN production_order_id integer REFERENCES production_orders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_dispatch_production_order ON dispatch(production_order_id);

-- Update existing users' roles
UPDATE users SET role = 'production' WHERE role = 'production_manager';
UPDATE users SET role = 'production_and_support' WHERE role = 'support';
