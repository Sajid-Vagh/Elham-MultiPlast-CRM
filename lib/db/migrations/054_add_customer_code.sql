-- Migration 054: Add customer_code to contacts for Client Identity Protection
-- Customer Code format: EML_001, EML_002, etc.
-- Only "My Client" contacts receive a code.

-- 1. Add customer_code column (nullable, unique)
ALTER TABLE contacts ADD COLUMN customer_code TEXT;
ALTER TABLE contacts ADD CONSTRAINT contacts_customer_code_unique UNIQUE (customer_code);

-- 2. Create sequence for customer codes
CREATE SEQUENCE IF NOT EXISTS customer_code_seq START 1;

-- 3. Backfill existing "My Client" contacts with codes (ordered by id)
DO $$
DECLARE
  rec RECORD;
  next_num INTEGER;
BEGIN
  SELECT COALESCE(MAX(
    CAST(SUBSTRING(customer_code FROM 5) AS INTEGER)
  ), 0) INTO next_num
  FROM contacts
  WHERE customer_code IS NOT NULL AND customer_code LIKE 'EML_%';

  FOR rec IN
    SELECT id FROM contacts
    WHERE category = 'My Client' AND customer_code IS NULL
    ORDER BY id
  LOOP
    next_num := next_num + 1;
    UPDATE contacts
    SET customer_code = 'EML_' || LPAD(next_num::TEXT, 3, '0')
    WHERE id = rec.id;
  END LOOP;
END $$;

-- 4. Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_contacts_customer_code ON contacts (customer_code) WHERE customer_code IS NOT NULL;
