CREATE TABLE IF NOT EXISTS "units" (
  "id" text PRIMARY KEY,
  "name" varchar(100) NOT NULL UNIQUE,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_units_name" ON "units" ("name");
CREATE INDEX IF NOT EXISTS "idx_units_is_active" ON "units" ("is_active");

-- Seed default units
INSERT INTO "units" ("id", "name", "is_active") VALUES
  ('unit-himatnagar', 'Himatnagar', true),
  ('unit-surat', 'Surat', true),
  ('unit-rajkot', 'Rajkot', true),
  ('unit-not-sure', 'Not Sure', true)
ON CONFLICT ("name") DO NOTHING;
