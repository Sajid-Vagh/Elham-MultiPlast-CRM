-- Voice Notes table: stores audio recordings uploaded by Sales during Mark Won,
-- streamed by Production team. Supports replace (versioning), soft-delete, and transcript.

CREATE TABLE IF NOT EXISTS voice_notes (
  id SERIAL PRIMARY KEY,
  deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
  proforma_invoice_id INTEGER REFERENCES proforma_invoices(id) ON DELETE SET NULL,
  production_order_id INTEGER REFERENCES production_orders(id) ON DELETE SET NULL,
  uploaded_by_id INTEGER NOT NULL REFERENCES users(id),
  file_name TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  duration_ms INTEGER,
  transcript TEXT,
  transcript_status TEXT NOT NULL DEFAULT 'pending',
  is_replaced BOOLEAN NOT NULL DEFAULT false,
  replaced_by_id INTEGER,
  deleted_at TIMESTAMPTZ,
  deleted_by_id INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voice_notes_deal ON voice_notes(deal_id);
CREATE INDEX IF NOT EXISTS idx_voice_notes_production_order ON voice_notes(production_order_id);
CREATE INDEX IF NOT EXISTS idx_voice_notes_pi ON voice_notes(proforma_invoice_id);
CREATE INDEX IF NOT EXISTS idx_voice_notes_active ON voice_notes(deal_id) WHERE is_replaced = false AND deleted_at IS NULL;
