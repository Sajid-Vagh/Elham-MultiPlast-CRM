-- Add created_by_id to notifications so the Admin "Owners" filter can attribute
-- who caused each notification (the acting user). Nullable: legacy rows and
-- notifications created without an acting user simply have no owner.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS created_by_id integer REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_created_by ON notifications(created_by_id);
