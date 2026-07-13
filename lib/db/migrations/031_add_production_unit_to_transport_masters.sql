-- Migration 031: Add productionUnit to product_bundle_master and transport_destination_master
-- Allows per-unit bundle sizes and destination rates
-- Himatnagar sees all; Surat/Rajkot see only their own

-- ============================================================
-- 1. Add productionUnit to product_bundle_master
-- ============================================================
ALTER TABLE product_bundle_master ADD COLUMN IF NOT EXISTS production_unit text;

-- Migrate existing data: NULL = "Himatnagar" (backward compat)
-- Do NOT backfill — NULL means "All Units" (shared)

-- ============================================================
-- 2. Add productionUnit to transport_destination_master
-- ============================================================
ALTER TABLE transport_destination_master ADD COLUMN IF NOT EXISTS production_unit text;

-- ============================================================
-- 3. Indexes for unit filtering
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_product_bundle_master_unit ON product_bundle_master(production_unit);
CREATE INDEX IF NOT EXISTS idx_transport_dest_master_unit ON transport_destination_master(production_unit);
