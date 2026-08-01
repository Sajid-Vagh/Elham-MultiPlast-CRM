-- Migration 068: Transport Rates — add TCI Bora / Normal Bora rate columns
-- The Transport Rates table now stores per-route rates for TCI transport and
-- normal transport instead of a single flat freight charge.
ALTER TABLE transport_destination_master
  ADD COLUMN IF NOT EXISTS tci_bora NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS normal_bora NUMERIC(12,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_tdm_tci_bora ON transport_destination_master(tci_bora);
CREATE INDEX IF NOT EXISTS idx_tdm_normal_bora ON transport_destination_master(normal_bora);
