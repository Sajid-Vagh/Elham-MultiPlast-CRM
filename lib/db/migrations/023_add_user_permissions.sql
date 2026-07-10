-- Migration 023: Add permissions JSONB column to users for role-based permission toggles
-- Supports: Sales, Support, Production Manager roles with granular permission controls

ALTER TABLE users ADD COLUMN permissions jsonb DEFAULT '{}';
