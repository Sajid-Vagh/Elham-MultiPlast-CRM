-- Migration 061: Add formatted_order_id to orders and production_orders
-- Backfill customer_codes for all contacts without one

-- 1. Add formatted_order_id column to orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS formatted_order_id TEXT;
CREATE INDEX IF NOT EXISTS idx_orders_formatted_order_id ON orders (formatted_order_id);

-- 2. Add formatted_order_id column to production_orders
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS formatted_order_id TEXT;
CREATE INDEX IF NOT EXISTS idx_production_orders_formatted_order_id ON production_orders (formatted_order_id);

-- 3. Initialize customer_code counter in id_counters (if not already present)
INSERT INTO id_counters (prefix, counter, updated_at)
SELECT 'customer_code', COALESCE(MAX(CAST(SUBSTRING(customer_code FROM 5) AS INTEGER)), 0), NOW()
FROM contacts
WHERE customer_code IS NOT NULL AND customer_code ~ '^EML_\d+$'
ON CONFLICT (prefix) DO NOTHING;

-- 4. Backfill customer_codes for all contacts that don't have one
-- Uses the customer_code_seq sequence (created in migration 054)
-- Format: EML_N (unpadded, continuous)
DO $$
DECLARE
  rec RECORD;
  next_num INTEGER;
BEGIN
  -- Get current max number from existing codes
  SELECT COALESCE(MAX(CAST(SUBSTRING(customer_code FROM 5) AS INTEGER)), 0)
  INTO next_num
  FROM contacts
  WHERE customer_code IS NOT NULL AND customer_code ~ '^EML_\d+$';

  -- Backfill contacts without customer_code, ordered by id
  FOR rec IN
    SELECT id FROM contacts
    WHERE customer_code IS NULL
    ORDER BY id
  LOOP
    next_num := next_num + 1;
    UPDATE contacts
    SET customer_code = 'EML_' || next_num::TEXT
    WHERE id = rec.id;
  END LOOP;

  -- Update the sequence to be in sync
  PERFORM setval('customer_code_seq', next_num);
END $$;

-- 5. Initialize order FY counters in id_counters (for current FY)
DO $$
DECLARE
  fy_prefix TEXT;
  max_seq INTEGER;
  current_year INTEGER;
  fy_start INTEGER;
  fy_end INTEGER;
BEGIN
  current_year := EXTRACT(YEAR FROM CURRENT_DATE);
  IF EXTRACT(MONTH FROM CURRENT_DATE) >= 4 THEN
    fy_start := current_year % 100;
    fy_end := (current_year + 1) % 100;
  ELSE
    fy_start := (current_year - 1) % 100;
    fy_end := current_year % 100;
  END IF;
  fy_prefix := 'order_' || LPAD(fy_start::TEXT, 2, '0') || LPAD(fy_end::TEXT, 2, '0');

  -- Get max sequence from existing formatted_order_ids for current FY
  SELECT COALESCE(MAX(CAST(SUBSTRING(formatted_order_id FROM 9) AS INTEGER)), 0)
  INTO max_seq
  FROM orders
  WHERE formatted_order_id LIKE 'EML_' || LPAD(fy_start::TEXT, 2, '0') || LPAD(fy_end::TEXT, 2, '0') || '_%';

  -- Initialize counter
  INSERT INTO id_counters (prefix, counter, updated_at)
  VALUES (fy_prefix, max_seq, NOW())
  ON CONFLICT (prefix) DO NOTHING;
END $$;
