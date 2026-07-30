-- Add product_id to proforma_invoice_items for strict variant tracking
ALTER TABLE proforma_invoice_items ADD COLUMN product_id INTEGER REFERENCES products(id) ON DELETE SET NULL;

-- Index for faster lookups during production sync
CREATE INDEX IF NOT EXISTS idx_pi_items_product_id ON proforma_invoice_items(product_id);

-- Update existing rows where product_id can be matched by name
-- This is best-effort: if multiple products share the same name, the first match wins
UPDATE proforma_invoice_items pi
SET product_id = (
  SELECT p.id FROM products p
  WHERE LOWER(p.name) = LOWER(pi.product_name)
  LIMIT 1
)
WHERE pi.product_id IS NULL;
