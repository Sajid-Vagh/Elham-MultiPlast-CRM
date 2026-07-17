-- Migration 040: Production Workflow Enhancements (Part 3)
-- Adds acceptance, planning, freeze, transfer history, delay, cancel tracking
-- Creates production_transfer_history table
-- Migrates old statuses to new workflow statuses

-- ============================================================
-- 1. Add new columns to production_orders
-- ============================================================

-- Scenario 2: Acceptance
ALTER TABLE production_orders ADD COLUMN accepted_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE production_orders ADD COLUMN accepted_at TIMESTAMPTZ;

-- Scenario 3: Planning
ALTER TABLE production_orders ADD COLUMN planned_machine TEXT;
ALTER TABLE production_orders ADD COLUMN expected_start_date TEXT;
ALTER TABLE production_orders ADD COLUMN expected_completion_date TEXT;

-- Scenario 4: Machine Running
ALTER TABLE production_orders ADD COLUMN started_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE production_orders ADD COLUMN started_at TIMESTAMPTZ;
ALTER TABLE production_orders ADD COLUMN is_frozen BOOLEAN NOT NULL DEFAULT false;

-- Scenario 6: PI Modification Detection
ALTER TABLE production_orders ADD COLUMN pi_version_at_creation INTEGER;

-- Scenario 5: Transfer tracking (on order itself for quick access)
ALTER TABLE production_orders ADD COLUMN previous_production_unit TEXT;

-- Scenario 9: Delay tracking
ALTER TABLE production_orders ADD COLUMN is_delayed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE production_orders ADD COLUMN delayed_at TIMESTAMPTZ;
ALTER TABLE production_orders ADD COLUMN delay_reason TEXT;

-- Scenario 10: Cancellation
ALTER TABLE production_orders ADD COLUMN cancelled_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE production_orders ADD COLUMN cancelled_at TIMESTAMPTZ;
ALTER TABLE production_orders ADD COLUMN cancel_reason TEXT;

-- ============================================================
-- 2. Add note_type to production_notes for categorized remarks
-- ============================================================
ALTER TABLE production_notes ADD COLUMN note_type TEXT NOT NULL DEFAULT 'general';

-- ============================================================
-- 3. Create production_transfer_history table (unlimited history)
-- ============================================================
CREATE TABLE IF NOT EXISTS production_transfer_history (
  id SERIAL PRIMARY KEY,
  production_order_id INTEGER NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  from_unit TEXT NOT NULL,
  to_unit TEXT NOT NULL,
  transferred_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transfer_history_order ON production_transfer_history(production_order_id);

-- ============================================================
-- 4. Create production_audit_trail table (immutable audit log)
-- ============================================================
CREATE TABLE IF NOT EXISTS production_audit_trail (
  id SERIAL PRIMARY KEY,
  production_order_id INTEGER NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  old_unit TEXT,
  new_unit TEXT,
  old_quantity TEXT,
  new_quantity TEXT,
  changed_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  changed_by_name TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_trail_order ON production_audit_trail(production_order_id);

-- ============================================================
-- 5. Migrate old statuses to new workflow statuses
-- ============================================================
-- Old: Pending, Material Ready, Production Started, In Process, Quality Check,
--       Packing, Ready For Dispatch, Completed, On Hold, Cancelled
-- New: Pending, Accepted, Planning, Machine Running, Quality Check,
--       Ready For Dispatch, Completed, Cancelled

UPDATE production_orders SET status = 'Accepted' WHERE status = 'Material Ready';
UPDATE production_orders SET status = 'Machine Running' WHERE status IN ('Production Started', 'In Process');
UPDATE production_orders SET status = 'Ready For Dispatch' WHERE status = 'Packing';
UPDATE production_orders SET status = 'Planning' WHERE status = 'On Hold';

-- ============================================================
-- 6. Performance indexes for new columns
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_production_orders_is_delayed ON production_orders(is_delayed);
CREATE INDEX IF NOT EXISTS idx_production_orders_is_frozen ON production_orders(is_frozen);
CREATE INDEX IF NOT EXISTS idx_production_notes_note_type ON production_notes(note_type);
