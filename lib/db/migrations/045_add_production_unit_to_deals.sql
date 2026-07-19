-- Add productionUnit to deals table: single source of truth for Production Unit across the lifecycle.
-- Once set at Deal creation, it flows automatically to Production Order on Won.

ALTER TABLE deals ADD COLUMN IF NOT EXISTS production_unit TEXT;

-- Backfill from contacts where possible (existing data migration)
UPDATE deals d
SET production_unit = c.unit
FROM contacts c
WHERE d.contact_id = c.id
  AND d.production_unit IS NULL
  AND c.unit IS NOT NULL
  AND c.unit != ''
  AND c.unit != 'To Be Assigned';

CREATE INDEX IF NOT EXISTS idx_deals_production_unit ON deals(production_unit);
