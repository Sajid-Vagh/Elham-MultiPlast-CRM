-- Migration 025: Add gramage to order_items + create transport_logistics table
-- Safe incremental update — no existing tables or columns are modified/deleted

-- 1. Add gramage column to order_items (nullable, backward-compatible)
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS gramage TEXT;

-- 2. Create transport_logistics table for transport cost lookup
CREATE TABLE IF NOT EXISTS transport_logistics (
  id SERIAL PRIMARY KEY,
  product_name TEXT NOT NULL,
  destination_state TEXT NOT NULL,
  destination_city TEXT NOT NULL,
  bundle_size_qty INTEGER NOT NULL,
  transport_cost_per_bundle NUMERIC(12, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for fast search by state/city/product
CREATE INDEX IF NOT EXISTS idx_transport_logistics_state ON transport_logistics(destination_state);
CREATE INDEX IF NOT EXISTS idx_transport_logistics_city ON transport_logistics(destination_city);
CREATE INDEX IF NOT EXISTS idx_transport_logistics_product ON transport_logistics(product_name);
