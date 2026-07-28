-- Migration 058: Add production_order_items table for product-wise production tracking
-- Each product line inside a production order gets its own status.

CREATE TABLE IF NOT EXISTS production_order_items (
  id SERIAL PRIMARY KEY,
  production_order_id INTEGER NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  pi_item_id INTEGER,
  product_name TEXT NOT NULL,
  material_type TEXT,
  machine_type TEXT,
  bottle_colour TEXT,
  bottle_weight TEXT,
  cap_colour TEXT,
  cap_weight TEXT,
  neck_size TEXT,
  hsn_code TEXT,
  ordered_quantity NUMERIC(12,2) NOT NULL,
  ready_quantity NUMERIC(12,2) NOT NULL DEFAULT 0,
  production_status TEXT NOT NULL DEFAULT 'Pending',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_production_order_items_order_id ON production_order_items(production_order_id);
CREATE INDEX idx_production_order_items_status ON production_order_items(production_status);
CREATE INDEX idx_production_order_items_pi_item ON production_order_items(pi_item_id);

COMMENT ON TABLE production_order_items IS 'Per-product production status tracking. Each PI line item gets its own production_status and ready_quantity.';
COMMENT ON COLUMN production_order_items.production_status IS 'Pending | In Production | Ready — per product line status';
COMMENT ON COLUMN production_order_items.ready_quantity IS 'Quantity produced and ready. Remaining = ordered_quantity - ready_quantity.';
