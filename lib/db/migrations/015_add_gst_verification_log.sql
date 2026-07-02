CREATE TABLE IF NOT EXISTS gst_verification_log (
  id SERIAL PRIMARY KEY,
  gstin TEXT NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ip_address TEXT,
  response_time_ms INTEGER,
  success BOOLEAN NOT NULL,
  response_data JSONB,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_gst_verification_log_gstin ON gst_verification_log(gstin);
CREATE INDEX IF NOT EXISTS idx_gst_verification_log_verified_at ON gst_verification_log(verified_at);
