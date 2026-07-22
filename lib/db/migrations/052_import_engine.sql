-- Migration 052: Import Engine tables
-- import_sessions: stores every import attempt with raw text, parser output, confidence, and result
-- import_corrections: self-learning engine tracks user corrections for future parsing improvements

CREATE TABLE IF NOT EXISTS import_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  source TEXT NOT NULL DEFAULT 'indiamart',
  raw_text TEXT,
  parser_version TEXT NOT NULL DEFAULT 'v1',
  parsed_data JSONB,
  edited_data JSONB,
  final_data JSONB,
  confidence JSONB,
  overall_confidence NUMERIC(5, 2),
  duplicate_detected BOOLEAN DEFAULT FALSE,
  duplicate_contact_id INTEGER,
  duplicate_action TEXT,
  result_lead_id INTEGER,
  result TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS import_corrections (
  id SERIAL PRIMARY KEY,
  field TEXT NOT NULL,
  original_value TEXT,
  corrected_value TEXT,
  source_pattern TEXT,
  hit_count INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for analytics queries
CREATE INDEX IF NOT EXISTS import_sessions_user_idx ON import_sessions(user_id);
CREATE INDEX IF NOT EXISTS import_sessions_source_idx ON import_sessions(source);
CREATE INDEX IF NOT EXISTS import_sessions_created_idx ON import_sessions(created_at);
CREATE INDEX IF NOT EXISTS import_sessions_parser_idx ON import_sessions(parser_version);
CREATE INDEX IF NOT EXISTS import_corrections_field_idx ON import_corrections(field);
CREATE INDEX IF NOT EXISTS import_corrections_pattern_idx ON import_corrections(source_pattern);
