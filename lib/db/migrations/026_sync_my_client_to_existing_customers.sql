-- One-time sync: Promote all "My Client" contacts to existing_customers
-- Run this ONCE against your Supabase/PostgreSQL database to backfill missing data.
-- Safe to run multiple times (uses INSERT ... WHERE NOT EXISTS).

INSERT INTO existing_customers (
  contact_id,
  sales_owner_id,
  total_orders,
  repeat_order_count,
  status,
  total_revenue,
  is_active,
  created_at,
  updated_at
)
SELECT
  c.id AS contact_id,
  c.sales_owner_id,
  COALESCE(sub.order_count, 0) AS total_orders,
  0 AS repeat_order_count,
  'Active' AS status,
  COALESCE(sub.total_revenue, '0') AS total_revenue,
  true AS is_active,
  NOW() AS created_at,
  NOW() AS updated_at
FROM contacts c
LEFT JOIN (
  SELECT
    o.contact_id,
    COUNT(*)::int AS order_count,
    SUM(o.grand_total::numeric)::text AS total_revenue
  FROM orders o
  WHERE o.is_deleted = false
  GROUP BY o.contact_id
) sub ON sub.contact_id = c.id
WHERE (c.category = 'My Client' OR c.is_my_client = true)
  AND NOT EXISTS (
    SELECT 1 FROM existing_customers ec WHERE ec.contact_id = c.id
  );

-- After running, optionally refresh stats for all promoted customers:
-- You can call GET /api/existing-customers/refresh/:contactId for each,
-- or let the existing-customers list page auto-refresh on next load.
