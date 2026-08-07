-- Migration 075: Add cancellation_acknowledged tracking to production_orders
-- Set to false whenever an order is cancelled (from a sales-order cancel or a
-- direct production cancel). True once a production/support user acknowledges
-- the cancellation on the order detail page.
--
-- Unacknowledged cancellations stay visible on the default production orders
-- list so they cannot be silently lost; acknowledged ones are hidden from the
-- default view (the "Cancelled" status filter still shows the full history).

ALTER TABLE production_orders
  ADD COLUMN IF NOT EXISTS cancellation_acknowledged BOOLEAN NOT NULL DEFAULT false;

-- Index for list queries that surface unacknowledged cancelled orders
CREATE INDEX IF NOT EXISTS idx_production_orders_cancellation_acknowledged
  ON production_orders(cancellation_acknowledged) WHERE cancellation_acknowledged = false;
