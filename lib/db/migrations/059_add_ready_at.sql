-- Migration 059: Add ready_at timestamp to production_orders
-- Records the exact time an order transitions to "Ready To Dispatch"

ALTER TABLE production_orders
  ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_production_orders_ready_at ON production_orders(ready_at);
