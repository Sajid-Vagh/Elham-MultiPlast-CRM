-- Migration: Add RBAC permission columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_view_all_reports BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_assign_leads BOOLEAN NOT NULL DEFAULT FALSE;
