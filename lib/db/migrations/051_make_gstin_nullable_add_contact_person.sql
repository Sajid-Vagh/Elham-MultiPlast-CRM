-- Migration 051: Make gstin nullable for non-GST customers + add contact_person column
-- Previously gstin was NOT NULL which prevented saving non-GST customers to Customer Master.

-- Drop the NOT NULL constraint on gstin (column is already text, just remove the constraint)
ALTER TABLE customer_master ALTER COLUMN gstin DROP NOT NULL;

-- Add contact_person column for storing the primary contact person name
ALTER TABLE customer_master ADD COLUMN IF NOT EXISTS contact_person text;
