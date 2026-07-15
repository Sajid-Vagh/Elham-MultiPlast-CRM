-- Add dispatch-related columns to production_orders
ALTER TABLE production_orders ADD COLUMN transport_name text;
ALTER TABLE production_orders ADD COLUMN transport_details text;
ALTER TABLE production_orders ADD COLUMN builty_url text;
ALTER TABLE production_orders ADD COLUMN dispatch_completed_at timestamp with time zone;
ALTER TABLE production_orders ADD COLUMN dispatch_completed_by integer REFERENCES users(id) ON DELETE SET NULL;

-- Index for dispatch queue queries (finding orders Ready For Dispatch)
CREATE INDEX idx_production_orders_status ON production_orders(status);
