-- Document Management System for Phase 7
-- Tables: documents (file metadata), document_versions (version history)

CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
  proforma_invoice_id INTEGER REFERENCES proforma_invoices(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  original_name TEXT NOT NULL,
  document_type TEXT NOT NULL DEFAULT 'Other',
  category TEXT NOT NULL DEFAULT 'Customer Documents',
  mime_type TEXT,
  file_extension TEXT,
  file_size NUMERIC(14,2),
  storage_path TEXT NOT NULL,
  storage_provider TEXT NOT NULL DEFAULT 'local',
  thumbnail_path TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'Active',
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS document_versions (
  id SERIAL PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  original_name TEXT NOT NULL,
  file_size NUMERIC(14,2),
  mime_type TEXT,
  storage_path TEXT NOT NULL,
  thumbnail_path TEXT,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  action TEXT NOT NULL DEFAULT 'upload',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_documents_contact_id ON documents(contact_id);
CREATE INDEX IF NOT EXISTS idx_documents_deal_id ON documents(deal_id);
CREATE INDEX IF NOT EXISTS idx_documents_proforma_invoice_id ON documents(proforma_invoice_id);
CREATE INDEX IF NOT EXISTS idx_documents_document_type ON documents(document_type);
CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category);
CREATE INDEX IF NOT EXISTS idx_documents_uploaded_by ON documents(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_documents_is_deleted ON documents(is_deleted);
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at);
CREATE INDEX IF NOT EXISTS idx_document_versions_document_id ON document_versions(document_id);
