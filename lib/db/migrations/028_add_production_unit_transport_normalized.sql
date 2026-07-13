-- Migration 028: Production Unit System + Transport Logistics Normalization
-- Adds productionUnit and productionRemarks to orders and production_orders
-- Creates product_bundle_master and transport_destination_master tables
-- Backward compatible: NULL productionUnit treated as "Unassigned"

-- ============================================================
-- 1. Add productionUnit and productionRemarks to orders
-- ============================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS production_unit text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS production_remarks text;

-- ============================================================
-- 2. Add productionUnit and productionRemarks to production_orders
-- ============================================================
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS production_unit text;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS production_remarks text;

-- ============================================================
-- 3. Product Bundle Master
-- ============================================================
CREATE TABLE IF NOT EXISTS product_bundle_master (
  id serial PRIMARY KEY,
  product_name text NOT NULL,
  product_id integer,
  bundle_size integer NOT NULL DEFAULT 80,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_bundle_master_product_name ON product_bundle_master(product_name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_bundle_master_product_active ON product_bundle_master(product_name) WHERE is_active = true;

-- ============================================================
-- 4. Transport Destination Master
-- ============================================================
CREATE TABLE IF NOT EXISTS transport_destination_master (
  id serial PRIMARY KEY,
  state text NOT NULL,
  city text NOT NULL,
  transport_type text NOT NULL DEFAULT 'Bundle Wise',
  transport_charge numeric(12, 2) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transport_dest_master_state ON transport_destination_master(state);
CREATE INDEX IF NOT EXISTS idx_transport_dest_master_city ON transport_destination_master(city);

-- ============================================================
-- 5. Indexes for production unit filtering
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_orders_production_unit ON orders(production_unit);
CREATE INDEX IF NOT EXISTS idx_production_orders_production_unit ON production_orders(production_unit);
