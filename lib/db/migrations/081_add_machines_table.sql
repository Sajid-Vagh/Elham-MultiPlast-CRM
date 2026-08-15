CREATE TABLE IF NOT EXISTS "machines" (
  "id" text PRIMARY KEY,
  "name" varchar(100) NOT NULL UNIQUE,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_machines_name" ON "machines" ("name");
CREATE INDEX IF NOT EXISTS "idx_machines_is_active" ON "machines" ("is_active");

-- Seed default machines
INSERT INTO "machines" ("id", "name", "is_active") VALUES
  ('machine-250ml-machine', '250ml Machine', true),
  ('machine-1l-machine', '1L Machine', true),
  ('machine-5l-machine', '5L Machine', true)
ON CONFLICT ("name") DO NOTHING;
