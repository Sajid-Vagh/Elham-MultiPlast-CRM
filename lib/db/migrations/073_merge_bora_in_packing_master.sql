-- Migration 073: Merge TCI Bora + Normal Bora into a single 'bora' column
-- on product_bundle_master (packing quantities).
--
-- Adds `bora`, backfills it with the higher of the two historical values
-- (preserves TCI data when a product only had TCI quantities), then drops
-- the two old columns. The order_items snapshot columns (order_items.tci_bora_qty
-- / normal_bora_qty) are intentionally left untouched.

ALTER TABLE product_bundle_master
  ADD COLUMN IF NOT EXISTS bora INTEGER DEFAULT 0;

UPDATE product_bundle_master
  SET bora = GREATEST(COALESCE(normal_bora_qty, 0), COALESCE(tci_bora_qty, 0));

ALTER TABLE product_bundle_master
  ALTER COLUMN bora SET NOT NULL;

ALTER TABLE product_bundle_master
  DROP COLUMN IF EXISTS tci_bora_qty,
  DROP COLUMN IF EXISTS normal_bora_qty;
