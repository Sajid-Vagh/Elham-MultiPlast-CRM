-- Fix: Convert empty-string unit values to NULL so they are properly
-- visible under the "Pending Unit" (To Be Assigned) filter.
-- Previously, selecting "To Be Assigned" in the lead form stored ""
-- (empty string) instead of NULL, making those leads invisible under
-- both specific unit filters and the "Pending Unit" filter.

UPDATE contacts SET unit = NULL WHERE unit = '';
