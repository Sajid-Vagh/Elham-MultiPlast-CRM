-- Migration 024: Add lost fields to contacts and deals

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS lost_reason TEXT,
  ADD COLUMN IF NOT EXISTS other_reason TEXT,
  ADD COLUMN IF NOT EXISTS lost_notes TEXT,
  ADD COLUMN IF NOT EXISTS lost_date TIMESTAMP WITH TIME ZONE;

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS other_reason TEXT,
  ADD COLUMN IF NOT EXISTS lost_notes TEXT;
