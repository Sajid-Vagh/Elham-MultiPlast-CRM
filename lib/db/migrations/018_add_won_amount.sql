-- Add won_amount column to deals table for WON deal revenue tracking
ALTER TABLE deals ADD COLUMN won_amount numeric(14, 2);
