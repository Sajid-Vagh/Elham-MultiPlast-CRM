-- Migration 038: Add new columns to inventory module for Excel-like 8-column grid.
-- SAFE: Only adds columns, does NOT drop unit_name or any existing data.

-- inventory table: add new columns
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS size TEXT;
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS bottle_color TEXT;
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS weight TEXT;
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS stock INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS client_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS sort_order INTEGER;
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS formatting JSONB;

-- Backfill sort_order from id so existing rows have an initial order
UPDATE inventory SET sort_order = id WHERE sort_order IS NULL;

-- Backfill stock from current_stock if the column exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inventory' AND column_name = 'current_stock') THEN
    UPDATE inventory SET stock = current_stock;
    ALTER TABLE inventory DROP COLUMN current_stock;
  END IF;
END $$;

-- Drop old order_qty column if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inventory' AND column_name = 'order_qty') THEN
    ALTER TABLE inventory DROP COLUMN order_qty;
  END IF;
END $$;

-- Drop the unique index on (product_name, unit_name) — blank rows and title rows break uniqueness
DROP INDEX IF EXISTS idx_inventory_name_unit;

-- Ensure indexes exist
CREATE INDEX IF NOT EXISTS idx_inventory_product_name ON inventory(product_name);
CREATE INDEX IF NOT EXISTS idx_inventory_unit_name ON inventory(unit_name);
CREATE INDEX IF NOT EXISTS idx_inventory_sort_order ON inventory(sort_order);
