-- Migration 074: Add is_read tracking to production_orders
-- True once the order has been viewed on its detail page (drives the "new order" blue dot).
-- needs_reprint (added in 056) drives the "updated / attention needed" amber dot.

ALTER TABLE production_orders
  ADD COLUMN IF NOT EXISTS is_read BOOLEAN NOT NULL DEFAULT false;

-- Index for list queries that surface unread pending orders
CREATE INDEX IF NOT EXISTS idx_production_orders_is_read
  ON production_orders(is_read) WHERE is_read = false;
