-- 037: Alter inventory tables for free-text product names
-- Run ONLY if 036 was already deployed with product_id NOT NULL + FK

-- inventory table: make product_id nullable, add product_name
ALTER TABLE inventory ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE inventory DROP CONSTRAINT IF EXISTS inventory_product_id_fkey;
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS product_name TEXT;

-- Backfill product_name from products table if data exists
UPDATE inventory i SET product_name = p.name FROM products p WHERE i.product_id = p.id AND i.product_name IS NULL;
UPDATE inventory SET product_name = 'Unknown' WHERE product_name IS NULL;

ALTER TABLE inventory ALTER COLUMN product_name SET NOT NULL;

-- Recreate indexes
DROP INDEX IF EXISTS idx_inventory_product_id;
DROP INDEX IF EXISTS idx_inventory_product_unit;
CREATE INDEX IF NOT EXISTS idx_inventory_product_name ON inventory(product_name);
CREATE INDEX IF NOT EXISTS idx_inventory_name_unit ON inventory(product_name, unit_name);

-- inventory_logs table: make product_id nullable, add product_name
ALTER TABLE inventory_logs ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE inventory_logs DROP CONSTRAINT IF EXISTS inventory_logs_product_id_fkey;
ALTER TABLE inventory_logs ADD COLUMN IF NOT EXISTS product_name TEXT;

-- Backfill product_name from products table if data exists
UPDATE inventory_logs il SET product_name = p.name FROM products p WHERE il.product_id = p.id AND il.product_name IS NULL;
UPDATE inventory_logs SET product_name = 'Unknown' WHERE product_name IS NULL;

ALTER TABLE inventory_logs ALTER COLUMN product_name SET NOT NULL;

-- Recreate indexes
DROP INDEX IF EXISTS idx_inventory_logs_product_id;
CREATE INDEX IF NOT EXISTS idx_inventory_logs_product_name ON inventory_logs(product_name);
