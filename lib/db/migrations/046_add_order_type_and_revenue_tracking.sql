-- Migration 046: Add order_type, created_by_role, revenue_owner_id to orders
-- Supports Sales vs Support workflow separation

ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_type text NOT NULL DEFAULT 'NEW';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS created_by_role text NOT NULL DEFAULT 'SALES';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS revenue_owner_id integer REFERENCES users(id) ON DELETE SET NULL;

-- Index for revenue reporting
CREATE INDEX IF NOT EXISTS idx_orders_order_type ON orders(order_type);
CREATE INDEX IF NOT EXISTS idx_orders_revenue_owner ON orders(revenue_owner_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_by_role ON orders(created_by_role);
