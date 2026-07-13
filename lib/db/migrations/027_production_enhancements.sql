-- 027: Production Module Enterprise Enhancements
-- Adds creator info to production_orders, status to products, and performance indexes

-- 1. Add permanent creator info columns to production_orders
ALTER TABLE production_orders ADD COLUMN created_by_id INTEGER REFERENCES users(id);
ALTER TABLE production_orders ADD COLUMN created_by_name TEXT;
ALTER TABLE production_orders ADD COLUMN created_by_role TEXT;

-- 2. Add status column to products (active/inactive)
ALTER TABLE products ADD COLUMN status TEXT NOT NULL DEFAULT 'active';

-- 3. Performance indexes for production_orders
CREATE INDEX idx_production_orders_created_by ON production_orders(created_by_id);
CREATE INDEX idx_production_orders_status ON production_orders(status);
CREATE INDEX idx_production_orders_created_at ON production_orders(created_at);
CREATE INDEX idx_production_orders_status_created ON production_orders(status, created_at);
