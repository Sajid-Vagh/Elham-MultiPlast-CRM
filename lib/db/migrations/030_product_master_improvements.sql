-- Migration 030: Product Master improvements
-- 1. Add machine_type column (nullable for backward compat)
-- 2. Add industry column + migrate data from category
-- 3. Make product_code nullable

-- 1. Add machine_type
ALTER TABLE products ADD COLUMN IF NOT EXISTS machine_type TEXT;

-- 2. Add industry column
ALTER TABLE products ADD COLUMN IF NOT EXISTS industry TEXT;

-- Migrate existing category values to industry
UPDATE products SET industry = category WHERE category IS NOT NULL AND industry IS NULL;

-- 3. Make product_code nullable (drop NOT NULL constraint)
-- PostgreSQL: alter column to drop not null
ALTER TABLE products ALTER COLUMN product_code DROP NOT NULL;
