-- Add alternative ID proof columns to customer_master so Unregistered customers
-- (PAN, Aadhaar, Voter ID, Driving License, etc.) can be saved and reused as profiles
-- just like GST-registered customers. GST profiles keep gstin; unregistered profiles
-- store id_proof_type + id_proof_number instead.
ALTER TABLE customer_master
  ADD COLUMN IF NOT EXISTS id_proof_type text,
  ADD COLUMN IF NOT EXISTS id_proof_number text;

-- Help lookups by ID proof number (used by the unregistered duplicate check).
CREATE INDEX IF NOT EXISTS idx_customer_master_id_proof_number
  ON customer_master (id_proof_number)
  WHERE is_deleted = false;
