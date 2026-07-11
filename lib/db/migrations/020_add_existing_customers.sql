CREATE TABLE IF NOT EXISTS "existing_customers" (
  "id" serial PRIMARY KEY,
  "contact_id" integer NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE UNIQUE,
  "sales_owner_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "support_owner_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "first_order_id" integer REFERENCES "orders"("id") ON DELETE SET NULL,
  "last_order_id" integer REFERENCES "orders"("id") ON DELETE SET NULL,
  "total_orders" integer NOT NULL DEFAULT 0,
  "repeat_order_count" integer NOT NULL DEFAULT 0,
  "first_order_date" text,
  "last_order_date" text,
  "last_product_name" text,
  "repeat_order_due_date" text,
  "current_production_status" text,
  "current_dispatch_status" text,
  "active_complaint_id" integer,
  "active_complaint_number" text,
  "status" text NOT NULL DEFAULT 'Active',
  "total_revenue" numeric(14, 2) DEFAULT '0',
  "first_order_at" timestamp with time zone,
  "last_order_at" timestamp with time zone,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_existing_customers_contact_id" ON "existing_customers" ("contact_id");
CREATE INDEX IF NOT EXISTS "idx_existing_customers_sales_owner_id" ON "existing_customers" ("sales_owner_id");
CREATE INDEX IF NOT EXISTS "idx_existing_customers_support_owner_id" ON "existing_customers" ("support_owner_id");
CREATE INDEX IF NOT EXISTS "idx_existing_customers_status" ON "existing_customers" ("status");
CREATE UNIQUE INDEX IF NOT EXISTS "existing_customers_contact_id_unique" ON "existing_customers" ("contact_id");
