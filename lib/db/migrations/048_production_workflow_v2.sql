-- Migration 048: Production Workflow v2
-- New status flow: Pending → Accepted → Planning → In Production → Packing → Ready For Dispatch → In Transport → Completed
-- Old statuses "Machine Running" → "In Production", "Quality Check" → "Packing"
-- Adds new columns for production machine, operator, packing, and transport booking details.

-- 1. Add new columns
ALTER TABLE production_orders
  ADD COLUMN IF NOT EXISTS production_machine text,
  ADD COLUMN IF NOT EXISTS operator_name text,
  ADD COLUMN IF NOT EXISTS in_production_notes text,
  ADD COLUMN IF NOT EXISTS packing_type text,
  ADD COLUMN IF NOT EXISTS packing_notes text,
  ADD COLUMN IF NOT EXISTS packing_completed_by_id integer REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS packing_completed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS transport_booked_by_id integer REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS transport_booked_at timestamp with time zone;

-- 2. Migrate existing statuses
UPDATE production_orders SET status = 'In Production' WHERE status = 'Machine Running';
UPDATE production_orders SET status = 'Packing' WHERE status = 'Quality Check';

-- 3. Migrate existing completed orders with dispatch info to In Transport
-- If status was 'Completed' and transport info exists, mark as 'In Transport'
-- (These were marked Complete after dispatch in old flow)
-- We keep old Completed status as-is (it means terminal now)

-- 4. For orders in 'Ready For Dispatch' with dispatch info already entered,
-- migrate to 'In Transport' since transport was already arranged
UPDATE production_orders
SET status = 'In Transport',
    transport_booked_by_id = dispatch_completed_by,
    transport_booked_at = dispatch_completed_at
WHERE status = 'Ready For Dispatch'
  AND (transport_name IS NOT NULL OR transport_details IS NOT NULL);

-- 5. Old 'Completed' orders that have transport info → keep as 'Completed'
-- (Completed is the final terminal status after In Transport)

-- 6. Add indexes for new columns
CREATE INDEX IF NOT EXISTS idx_production_orders_packing_type ON production_orders(packing_type);
CREATE INDEX IF NOT EXISTS idx_production_orders_in_production ON production_orders(production_machine);

-- 7. Add packing_type check constraint
ALTER TABLE production_orders ADD CONSTRAINT check_packing_type
  CHECK (packing_type IS NULL OR packing_type IN ('Bundle', 'Packet'));

COMMENT ON TABLE production_orders IS 'Production orders v2 workflow: Pending→Accepted→Planning→In Production→Packing→Ready For Dispatch→In Transport→Completed';
