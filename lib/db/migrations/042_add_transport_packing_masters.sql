-- Migration 042: Transport & Packing Master Enhancement
-- Extends existing transport_destination_master and product_bundle_master
-- Adds PIN code, transport company, transit days, packing breakdowns
-- Adds order-level transport snapshot and order-item-level packing snapshot
-- Creates import_batches table for Excel import undo support

-- ============================================================
-- 1. Transport Destination Master: add columns
-- ============================================================
ALTER TABLE transport_destination_master
  ADD COLUMN IF NOT EXISTS pin_code TEXT,
  ADD COLUMN IF NOT EXISTS transport_company TEXT,
  ADD COLUMN IF NOT EXISTS transit_days INTEGER,
  ADD COLUMN IF NOT EXISTS remarks TEXT,
  ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS import_batch_id INTEGER,
  -- future-ready columns (nullable, unused now)
  ADD COLUMN IF NOT EXISTS transport_zone TEXT,
  ADD COLUMN IF NOT EXISTS distance_km NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS weight_slab_min NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS weight_slab_max NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS vehicle_type TEXT,
  ADD COLUMN IF NOT EXISTS min_freight NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS max_freight NUMERIC(12,2);

CREATE INDEX IF NOT EXISTS idx_tdm_pin_code ON transport_destination_master(pin_code);
CREATE INDEX IF NOT EXISTS idx_tdm_factory_pin ON transport_destination_master(production_unit, pin_code);
CREATE INDEX IF NOT EXISTS idx_tdm_company ON transport_destination_master(transport_company);
CREATE INDEX IF NOT EXISTS idx_tdm_import_batch ON transport_destination_master(import_batch_id);

-- ============================================================
-- 2. Product Bundle Master: add columns
-- ============================================================
ALTER TABLE product_bundle_master
  ADD COLUMN IF NOT EXISTS liner_packing_qty INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tci_bora_qty INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS normal_bora_qty INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remarks TEXT,
  ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS import_batch_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_pbm_import_batch ON product_bundle_master(import_batch_id);

-- ============================================================
-- 3. Orders: transport snapshot columns
-- ============================================================
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS transport_master_id INTEGER REFERENCES transport_destination_master(id),
  ADD COLUMN IF NOT EXISTS transport_company TEXT,
  ADD COLUMN IF NOT EXISTS freight_charge_snapshot NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS transit_days_snapshot INTEGER;

-- ============================================================
-- 4. Order Items: packing snapshot columns
-- ============================================================
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS packing_master_id INTEGER REFERENCES product_bundle_master(id),
  ADD COLUMN IF NOT EXISTS liner_packing_qty INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tci_bora_qty INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS normal_bora_qty INTEGER DEFAULT 0;

-- ============================================================
-- 5. Import Batches table
-- ============================================================
CREATE TABLE IF NOT EXISTS import_batches (
  id SERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,
  imported_by INTEGER REFERENCES users(id),
  file_name TEXT,
  row_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  report JSONB,
  undone_at TIMESTAMPTZ,
  undone_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_batches_entity ON import_batches(entity_type);
CREATE INDEX IF NOT EXISTS idx_import_batches_undone ON import_batches(undone_at);
