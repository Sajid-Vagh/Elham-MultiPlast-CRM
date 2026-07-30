-- Fix any NULL production_status values in production_order_items
-- The schema defines production_status as NOT NULL with default 'Pending',
-- but existing rows may have NULL if they were inserted before the constraint
-- was enforced or via direct DB operations.
UPDATE production_order_items
SET production_status = 'Pending'
WHERE production_status IS NULL;

-- Fix any NULL ready_quantity values (should be '0' default)
UPDATE production_order_items
SET ready_quantity = '0'
WHERE ready_quantity IS NULL;

-- Ensure any NULL ordered_quantity has a safe default
UPDATE production_order_items
SET ordered_quantity = '0'
WHERE ordered_quantity IS NULL OR ordered_quantity = '';
