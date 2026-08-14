-- Master Product + Variants
-- Adds product_variants so the flat `products` table becomes Master Products
-- (one row per product family) with weight/colour variants stored separately.
-- Product references in proforma_invoice_items / order_items / deal_products keep
-- pointing at the MASTER product id; the chosen weight + colour live in the item row.

CREATE TABLE IF NOT EXISTS product_variants (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  weight TEXT,
  default_color TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_variants_product_id ON product_variants(product_id);

-- The backfill of existing flat products into masters + variants is performed by
-- scripts/src/backfill-product-variants.ts (dry-run by default, --apply to run).
-- Run the migration (this file) BEFORE running the backfill script.
