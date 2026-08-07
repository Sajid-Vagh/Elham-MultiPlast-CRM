-- Migration 076: Add is_updated tracking to production_orders
-- Drives the "Updated Order" amber dot on the production orders list. Set to true
-- whenever a linked Proforma Invoice is modified (handlePiModification); cleared to
-- false when a production user views the order detail page (POST /production/orders/:id/read).
-- This is intentionally SEPARATE from needs_reprint (migration 056), which still drives
-- the "Updated Production Sheet Required" reminder + reprint filter.

ALTER TABLE production_orders
  ADD COLUMN IF NOT EXISTS is_updated BOOLEAN NOT NULL DEFAULT false;

-- Backfill: orders already flagged needs_reprint (revised before this migration ran)
-- should immediately show the amber dot, while still keeping needs_reprint true so the
-- production sheet reprint reminder is not lost.
UPDATE production_orders
  SET is_updated = true
  WHERE needs_reprint = true;

-- Index for list queries that surface updated pending orders
CREATE INDEX IF NOT EXISTS idx_production_orders_is_updated
  ON production_orders(is_updated) WHERE is_updated = true;
