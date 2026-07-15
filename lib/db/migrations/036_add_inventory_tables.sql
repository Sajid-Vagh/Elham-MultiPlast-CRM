-- 036: Add inventory management tables

CREATE TABLE IF NOT EXISTS inventory (
  id SERIAL PRIMARY KEY,
  product_id INTEGER,
  product_name TEXT NOT NULL,
  unit_name TEXT NOT NULL,
  current_stock INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_product_name ON inventory(product_name);
CREATE INDEX IF NOT EXISTS idx_inventory_unit_name ON inventory(unit_name);
CREATE INDEX IF NOT EXISTS idx_inventory_name_unit ON inventory(product_name, unit_name);

CREATE TABLE IF NOT EXISTS inventory_logs (
  id SERIAL PRIMARY KEY,
  product_id INTEGER,
  product_name TEXT NOT NULL,
  unit_name TEXT NOT NULL,
  adjustment_type TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  previous_stock INTEGER NOT NULL,
  new_stock INTEGER NOT NULL,
  notes TEXT,
  created_by INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_logs_product_name ON inventory_logs(product_name);
CREATE INDEX IF NOT EXISTS idx_inventory_logs_unit_name ON inventory_logs(unit_name);
CREATE INDEX IF NOT EXISTS idx_inventory_logs_created_at ON inventory_logs(created_at);
