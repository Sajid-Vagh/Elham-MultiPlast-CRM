-- Migration 047: Add requested_unit to production_orders
-- requestedUnit stores the original production unit, never changes on transfer

ALTER TABLE production_orders
  ADD COLUMN requested_unit text;

-- Backfill existing rows: set requested_unit = production_unit
UPDATE production_orders
  SET requested_unit = production_unit
  WHERE requested_unit IS NULL;

-- Notify (index on created_by_role for origin filtering)
CREATE INDEX IF NOT EXISTS idx_production_orders_created_by_role
  ON production_orders (created_by_role);

CREATE INDEX IF NOT EXISTS idx_production_orders_requested_unit
  ON production_orders (requested_unit);
