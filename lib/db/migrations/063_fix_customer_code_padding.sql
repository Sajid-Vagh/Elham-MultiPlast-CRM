-- Migration 063: Fix Customer Code Padding
-- Convert zero-padded codes (EML_008) to clean numeric (EML_8)
-- Also updates id_counters to reflect max unpadded value

-- 1. Fix padded customer codes in contacts table
UPDATE contacts
SET customer_code = regexp_replace(customer_code, '^EML_0+(\d+)$', 'EML_\1')
WHERE customer_code ~ '^EML_0+\d+$';

-- 2. Update id_counters to the max unpadded value
INSERT INTO id_counters (prefix, counter, updated_at)
SELECT 'customer_code', COALESCE(MAX(CAST(SUBSTRING(customer_code FROM 5) AS INTEGER)), 0), NOW()
FROM contacts
WHERE customer_code IS NOT NULL AND customer_code ~ '^EML_\d+$'
ON CONFLICT (prefix) DO UPDATE SET counter = EXCLUDED.counter, updated_at = NOW();
