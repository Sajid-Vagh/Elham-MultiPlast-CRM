-- Migration 050: Add bottle_colour_code (hex) to products table
-- Stores hex color code like '#800080' alongside the color name

ALTER TABLE products ADD COLUMN bottle_colour_code TEXT;

-- Backfill: map known color names to hex codes
UPDATE products SET bottle_colour_code = '#800080' WHERE LOWER(bottle_colour) = 'purple';
UPDATE products SET bottle_colour_code = '#2563EB' WHERE LOWER(bottle_colour) = 'blue';
UPDATE products SET bottle_colour_code = '#16A34A' WHERE LOWER(bottle_colour) = 'green';
UPDATE products SET bottle_colour_code = '#DC2626' WHERE LOWER(bottle_colour) = 'red';
UPDATE products SET bottle_colour_code = '#EAB308' WHERE LOWER(bottle_colour) = 'yellow';
UPDATE products SET bottle_colour_code = '#F97316' WHERE LOWER(bottle_colour) = 'orange';
UPDATE products SET bottle_colour_code = '#000000' WHERE LOWER(bottle_colour) = 'black';
UPDATE products SET bottle_colour_code = '#FFFFFF' WHERE LOWER(bottle_colour) = 'white';
UPDATE products SET bottle_colour_code = '#E5E7EB' WHERE LOWER(bottle_colour) = 'transparent';
