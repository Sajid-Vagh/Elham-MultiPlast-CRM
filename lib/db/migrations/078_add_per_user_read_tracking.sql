-- Migration 078: Per-user read tracking
--
-- Replaces the single GLOBAL is_read / is_updated booleans with per-user
-- read-state arrays. Each array stores the user IDs that have acknowledged the
-- item, so one user reading a lead / production order no longer clears the
-- unread indicator for everyone else.
--
--   contacts.read_by            — users who have read this lead (blue "new lead" dot)
--   production_orders.read_by   — users who have viewed the order (blue "new order" dot)
--   production_orders.updated_read_by — users who have seen the latest PI update
--                                  (amber "updated order" dot)
--
-- The legacy is_read / is_updated / is_repeat_enquiry columns are KEPT for
-- backward compatibility (existing code/exports), but the CRM now computes the
-- read state per-user from these arrays.

-- ── contacts ───────────────────────────────────────────────────────────────
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS read_by INTEGER[] NOT NULL DEFAULT '{}';

-- Backfill: leads globally marked read (is_read = true) were invisible to
-- everyone; populate read_by with every active user so they stay hidden.
-- Leads marked unread keep an empty read_by so the dot remains visible to
-- every user until each one reads it (preserving current behaviour).
UPDATE contacts
  SET read_by = ARRAY(SELECT id FROM users)
  WHERE read_by = '{}' AND is_read = true;

CREATE INDEX IF NOT EXISTS idx_contacts_read_by ON contacts(read_by);

-- ── production_orders ──────────────────────────────────────────────────────
ALTER TABLE production_orders
  ADD COLUMN IF NOT EXISTS read_by INTEGER[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS updated_read_by INTEGER[] NOT NULL DEFAULT '{}';

-- Blue dot: orders already viewed (is_read = true) were invisible to everyone.
UPDATE production_orders
  SET read_by = ARRAY(SELECT id FROM users)
  WHERE read_by = '{}' AND is_read = true;

-- Amber dot: orders WITHOUT the update flag (is_updated = false) had no amber
-- dot for anyone; mark as seen by every user so it stays hidden. Orders WITH
-- is_updated = true keep an empty updated_read_by so the amber dot shows for
-- every user until each one opens the order (true per-user behaviour).
UPDATE production_orders
  SET updated_read_by = ARRAY(SELECT id FROM users)
  WHERE updated_read_by = '{}' AND is_updated = false;

CREATE INDEX IF NOT EXISTS idx_production_orders_read_by ON production_orders(read_by);
CREATE INDEX IF NOT EXISTS idx_production_orders_updated_read_by ON production_orders(updated_read_by);
