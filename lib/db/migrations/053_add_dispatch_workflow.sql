-- Migration 053: Add dispatch workflow columns to production_orders
-- Production ends at "Ready To Dispatch", Dispatch module handles the rest.

-- Add dispatch workflow columns
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS dispatch_status text;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS lr_number text;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS dispatch_remarks text;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS dispatched_by_id integer REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS dispatched_at timestamptz;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS delivery_date text;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS delivered_by_id integer REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

-- Migrate existing dispatch data: orders with transportName and status "Ready To Dispatch" → "Pending Dispatch"
UPDATE production_orders
SET dispatch_status = 'Pending Dispatch'
WHERE status = 'Ready To Dispatch'
  AND dispatch_status IS NULL;

-- Migrate: orders with dispatchCompletedAt → "Delivered"
UPDATE production_orders
SET dispatch_status = 'Delivered'
WHERE dispatch_completed_at IS NOT NULL
  AND dispatch_status IS NULL;

-- Migrate: orders with transportName but not delivered → "Load Vehicle"
UPDATE production_orders
SET dispatch_status = 'Load Vehicle'
WHERE transport_name IS NOT NULL
  AND dispatch_status IS NULL
  AND status = 'Ready To Dispatch';

-- Indexes for dispatch filtering
CREATE INDEX IF NOT EXISTS idx_production_orders_dispatch_status ON production_orders(dispatch_status);
CREATE INDEX IF NOT EXISTS idx_production_orders_status_dispatch ON production_orders(status, dispatch_status);
