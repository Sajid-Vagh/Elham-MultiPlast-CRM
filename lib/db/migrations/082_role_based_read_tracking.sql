-- Migration 082: Role-based read tracking for Leads
-- Adds is_read_by_admin and is_read_by_assignee booleans to replace the per-user
-- readBy array with a simpler role-based model:
--   - Admin opens lead  → isReadByAdmin = true  (assignee still sees dot)
--   - Salesperson opens → isReadByAssignee = true AND isReadByAdmin = true (both see read)
--
-- Backfills from the existing read_by array:
--   is_read_by_admin    = ANY admin user ID is in read_by  OR  (is_read AND read_by is empty)
--   is_read_by_assignee = sales_owner ID is in read_by     OR  (is_read AND read_by is empty)

ALTER TABLE contacts ADD COLUMN is_read_by_admin    BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE contacts ADD COLUMN is_read_by_assignee BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill: admin users (role = 'admin') in read_by → is_read_by_admin
UPDATE contacts c
SET is_read_by_admin = TRUE
WHERE c.is_read = TRUE AND c.read_by = '{}';

UPDATE contacts c
SET is_read_by_admin = TRUE
WHERE EXISTS (
  SELECT 1 FROM unnest(c.read_by) AS uid
  JOIN users u ON u.id = uid
  WHERE u.role = 'admin'
);

-- Backfill: sales owner in read_by → is_read_by_assignee
UPDATE contacts c
SET is_read_by_assignee = TRUE
WHERE c.is_read = TRUE AND c.read_by = '{}';

UPDATE contacts c
SET is_read_by_assignee = TRUE
WHERE EXISTS (
  SELECT 1 FROM unnest(c.read_by) AS uid
  WHERE uid = c.sales_owner_id
);

CREATE INDEX idx_contacts_is_read_by_admin    ON contacts(is_read_by_admin);
CREATE INDEX idx_contacts_is_read_by_assignee ON contacts(is_read_by_assignee);
