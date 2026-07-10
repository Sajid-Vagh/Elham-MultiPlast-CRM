-- Migration 022: Manufacturing ERP tables
-- Adds: orders, order_items, quotations, quotation_items, order_revisions, order_timeline,
--        production_batches, production_batch_items, qc_reports, dispatch, dispatch_items,
--        complaints, complaint_updates, customer_communications, audit_logs, internal_notes, id_counters

-- ORDERS
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  customer_name TEXT NOT NULL,
  company_name TEXT,
  mobile TEXT,
  email TEXT,
  gst_number TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  source TEXT NOT NULL DEFAULT 'New Lead',
  customer_type TEXT NOT NULL DEFAULT 'New Customer',
  status TEXT NOT NULL DEFAULT 'Draft',
  sales_owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  support_owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  production_owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  approved_by INTEGER REFERENCES users(id),
  verified_by INTEGER REFERENCES users(id),
  dispatch_handled_by INTEGER REFERENCES users(id),
  total_amount NUMERIC(14,2) NOT NULL DEFAULT '0',
  total_gst NUMERIC(14,2) NOT NULL DEFAULT '0',
  grand_total NUMERIC(14,2) NOT NULL DEFAULT '0',
  freight NUMERIC(14,2) NOT NULL DEFAULT '0',
  payment_terms TEXT,
  delivery_terms TEXT,
  expected_delivery_date TEXT,
  dispatch_address TEXT,
  transport_details TEXT,
  remarks TEXT,
  quotation_id INTEGER,
  previous_order_id INTEGER,
  is_repeat_order BOOLEAN NOT NULL DEFAULT false,
  health_status TEXT NOT NULL DEFAULT 'Healthy',
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ,
  deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_contact_id ON orders(contact_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_sales_owner ON orders(sales_owner_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);

-- ORDER ITEMS
CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  product_code TEXT,
  bottle_type TEXT,
  bottle_weight TEXT,
  cap_colour TEXT,
  colour TEXT,
  hsn_code TEXT,
  capacity TEXT,
  quantity NUMERIC(12,2) NOT NULL,
  unit TEXT NOT NULL DEFAULT 'Pcs',
  rate NUMERIC(12,2) NOT NULL DEFAULT '0',
  gst_percent NUMERIC(5,2) DEFAULT '0',
  amount NUMERIC(14,2) NOT NULL DEFAULT '0',
  status TEXT NOT NULL DEFAULT 'Pending',
  ready_quantity NUMERIC(12,2) NOT NULL DEFAULT '0',
  dispatched_quantity NUMERIC(12,2) NOT NULL DEFAULT '0',
  batch_number TEXT,
  dispatch_status TEXT NOT NULL DEFAULT 'Pending',
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);

-- QUOTATIONS
CREATE TABLE IF NOT EXISTS quotations (
  id SERIAL PRIMARY KEY,
  quotation_number TEXT NOT NULL UNIQUE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  customer_name TEXT NOT NULL,
  company_name TEXT,
  mobile TEXT,
  email TEXT,
  gst_number TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  status TEXT NOT NULL DEFAULT 'Draft',
  sales_owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  total_amount NUMERIC(14,2) NOT NULL DEFAULT '0',
  total_gst NUMERIC(14,2) NOT NULL DEFAULT '0',
  grand_total NUMERIC(14,2) NOT NULL DEFAULT '0',
  freight NUMERIC(14,2) NOT NULL DEFAULT '0',
  payment_terms TEXT,
  delivery_terms TEXT,
  validity_days INTEGER DEFAULT 15,
  notes TEXT,
  converted_order_id INTEGER,
  converted_at TIMESTAMPTZ,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ,
  deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quotations_contact_id ON quotations(contact_id);

-- QUOTATION ITEMS
CREATE TABLE IF NOT EXISTS quotation_items (
  id SERIAL PRIMARY KEY,
  quotation_id INTEGER NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  product_code TEXT,
  bottle_type TEXT,
  bottle_weight TEXT,
  cap_colour TEXT,
  colour TEXT,
  hsn_code TEXT,
  capacity TEXT,
  quantity NUMERIC(12,2) NOT NULL,
  unit TEXT NOT NULL DEFAULT 'Pcs',
  rate NUMERIC(12,2) NOT NULL DEFAULT '0',
  gst_percent NUMERIC(5,2) DEFAULT '0',
  amount NUMERIC(14,2) NOT NULL DEFAULT '0',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quotation_items_quotation_id ON quotation_items(quotation_id);

-- ORDER REVISIONS
CREATE TABLE IF NOT EXISTS order_revisions (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  changed_by INTEGER NOT NULL REFERENCES users(id),
  department TEXT,
  reason TEXT NOT NULL,
  changes JSONB NOT NULL,
  previous_data JSONB,
  new_data JSONB,
  approval_required BOOLEAN NOT NULL DEFAULT false,
  approved_by INTEGER REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'Pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_revisions_order_id ON order_revisions(order_id);

-- ORDER TIMELINE
CREATE TABLE IF NOT EXISTS order_timeline (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id INTEGER,
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  metadata TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_timeline_order_id ON order_timeline(order_id);

-- PRODUCTION BATCHES
CREATE TABLE IF NOT EXISTS production_batches (
  id SERIAL PRIMARY KEY,
  batch_number TEXT NOT NULL UNIQUE,
  product_name TEXT NOT NULL,
  product_code TEXT,
  total_quantity NUMERIC(12,2) NOT NULL,
  completed_quantity NUMERIC(12,2) NOT NULL DEFAULT '0',
  rejected_quantity NUMERIC(12,2) NOT NULL DEFAULT '0',
  status TEXT NOT NULL DEFAULT 'Planned',
  priority TEXT NOT NULL DEFAULT 'Normal',
  machine TEXT,
  machine_capacity TEXT,
  operator TEXT,
  shift TEXT,
  expected_completion_date TEXT,
  actual_completion_date TEXT,
  progress INTEGER NOT NULL DEFAULT 0,
  orders_included JSONB DEFAULT '[]',
  assigned_production_manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_production_batches_status ON production_batches(status);
CREATE INDEX IF NOT EXISTS idx_production_batches_product ON production_batches(product_name);

-- PRODUCTION BATCH ITEMS
CREATE TABLE IF NOT EXISTS production_batch_items (
  id SERIAL PRIMARY KEY,
  batch_id INTEGER NOT NULL REFERENCES production_batches(id) ON DELETE CASCADE,
  order_item_id INTEGER,
  order_id INTEGER,
  product_name TEXT NOT NULL,
  quantity NUMERIC(12,2) NOT NULL,
  completed_quantity NUMERIC(12,2) NOT NULL DEFAULT '0',
  rejected_quantity NUMERIC(12,2) NOT NULL DEFAULT '0',
  status TEXT NOT NULL DEFAULT 'Pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_batch_items_batch_id ON production_batch_items(batch_id);

-- QC REPORTS
CREATE TABLE IF NOT EXISTS qc_reports (
  id SERIAL PRIMARY KEY,
  batch_id INTEGER NOT NULL REFERENCES production_batches(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'Pending',
  qc_person TEXT,
  qc_date TEXT,
  bottle_weight TEXT,
  color_check TEXT,
  leak_test TEXT,
  cap_fitting TEXT,
  visual_inspection TEXT,
  overall_result TEXT,
  remarks TEXT,
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qc_reports_batch_id ON qc_reports(batch_id);

-- DISPATCH
CREATE TABLE IF NOT EXISTS dispatch (
  id SERIAL PRIMARY KEY,
  dispatch_number TEXT NOT NULL UNIQUE,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'Pending',
  vehicle_number TEXT,
  driver_name TEXT,
  driver_mobile TEXT,
  transport_company TEXT,
  lr_number TEXT,
  tracking_number TEXT,
  dispatch_date TEXT,
  expected_delivery_date TEXT,
  delivered_date TEXT,
  dispatch_address TEXT,
  dispatch_handled_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  freight NUMERIC(14,2) DEFAULT '0',
  remarks TEXT,
  proof_of_delivery TEXT,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ,
  deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dispatch_order_id ON dispatch(order_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_status ON dispatch(status);

-- DISPATCH ITEMS
CREATE TABLE IF NOT EXISTS dispatch_items (
  id SERIAL PRIMARY KEY,
  dispatch_id INTEGER NOT NULL REFERENCES dispatch(id) ON DELETE CASCADE,
  order_item_id INTEGER,
  product_name TEXT NOT NULL,
  quantity NUMERIC(12,2) NOT NULL,
  batch_number TEXT,
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dispatch_items_dispatch_id ON dispatch_items(dispatch_id);

-- COMPLAINTS
CREATE TABLE IF NOT EXISTS complaints (
  id SERIAL PRIMARY KEY,
  complaint_number TEXT NOT NULL UNIQUE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  order_item_id INTEGER,
  customer_name TEXT NOT NULL,
  product_name TEXT,
  quantity NUMERIC(12,2),
  complaint_type TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'Medium',
  status TEXT NOT NULL DEFAULT 'Open',
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_department TEXT,
  replacement_order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  resolution TEXT,
  closed_at TIMESTAMPTZ,
  closed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ,
  deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_complaints_contact_id ON complaints(contact_id);
CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status);
CREATE INDEX IF NOT EXISTS idx_complaints_assigned_to ON complaints(assigned_to);

-- COMPLAINT UPDATES
CREATE TABLE IF NOT EXISTS complaint_updates (
  id SERIAL PRIMARY KEY,
  complaint_id INTEGER NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  status_from TEXT,
  status_to TEXT NOT NULL,
  notes TEXT,
  changed_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_complaint_updates_complaint_id ON complaint_updates(complaint_id);

-- CUSTOMER COMMUNICATIONS
CREATE TABLE IF NOT EXISTS customer_communications (
  id SERIAL PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  order_id INTEGER,
  type TEXT NOT NULL,
  direction TEXT DEFAULT 'Outbound',
  notes TEXT NOT NULL,
  next_action TEXT,
  next_action_date TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  department TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_communications_contact_id ON customer_communications(contact_id);

-- AUDIT LOGS
CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  department TEXT,
  role TEXT,
  reason TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_changed_by ON audit_logs(changed_by);

-- INTERNAL NOTES
CREATE TABLE IF NOT EXISTS internal_notes (
  id SERIAL PRIMARY KEY,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  department TEXT,
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  is_resolved BOOLEAN NOT NULL DEFAULT false,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_internal_notes_contact_id ON internal_notes(contact_id);
CREATE INDEX IF NOT EXISTS idx_internal_notes_order_id ON internal_notes(order_id);

-- ID COUNTERS
CREATE TABLE IF NOT EXISTS id_counters (
  id SERIAL PRIMARY KEY,
  prefix TEXT NOT NULL UNIQUE,
  counter INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO id_counters (prefix, counter) VALUES
  ('CUS', 0), ('LEAD', 0), ('QT', 0), ('ORD', 0),
  ('BAT', 0), ('DSP', 0), ('CMP', 0), ('REV', 0)
ON CONFLICT (prefix) DO NOTHING;

-- ALTER contacts to add support_owner_id and production_manager_id
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS support_owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS production_manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
