-- Migration 041: Order Cancellation + Complaint Enhancements
-- Part 4: Customer Lifecycle and Security

-- ============================================================
-- 1. ORDER CANCELLATION COLUMNS
-- ============================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancellation_other_reason TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancellation_note TEXT;

-- Index for cancelled orders queries
CREATE INDEX IF NOT EXISTS idx_orders_cancelled ON orders(cancelled_at) WHERE cancelled_at IS NOT NULL;

-- ============================================================
-- 2. COMPLAINT ENHANCEMENT COLUMNS
-- ============================================================

ALTER TABLE complaints ADD COLUMN IF NOT EXISTS root_cause TEXT;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- Index for complaint resolution queries
CREATE INDEX IF NOT EXISTS idx_complaints_resolved ON complaints(resolved_at) WHERE resolved_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_complaints_assigned ON complaints(assigned_to) WHERE assigned_to IS NOT NULL;
