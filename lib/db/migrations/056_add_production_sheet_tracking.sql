-- Migration 056: Add production sheet tracking columns to production_orders
-- Tracks when a production sheet was generated, who generated it, version, and reprint flag

ALTER TABLE production_orders
  ADD COLUMN IF NOT EXISTS production_sheet_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS production_sheet_generated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS production_sheet_version INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS needs_reprint BOOLEAN NOT NULL DEFAULT false;

-- Index for dashboard queries (needsReprint count, sheet generation tracking)
CREATE INDEX IF NOT EXISTS idx_production_orders_needs_reprint ON production_orders(needs_reprint) WHERE needs_reprint = true;
CREATE INDEX IF NOT EXISTS idx_production_orders_sheet_generated ON production_orders(production_sheet_generated_at);
