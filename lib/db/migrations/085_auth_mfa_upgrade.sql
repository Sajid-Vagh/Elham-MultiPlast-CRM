-- Migration 085: Auth security upgrade — MFA, OTP, Recovery Codes
-- Adds TOTP MFA columns, email OTP columns, recovery codes, and security metadata to users table.
-- No existing data is destroyed; all new columns have safe defaults.

-- ─── Users: MFA + OTP columns ──────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret_encrypted text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_verified_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_codes_hash text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_setup_token text;

ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_hash text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_expires_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_attempts integer NOT NULL DEFAULT 0;

-- ─── Indexes ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_mfa_enabled ON users(mfa_enabled) WHERE mfa_enabled = true;
CREATE INDEX IF NOT EXISTS idx_users_mfa_setup_token ON users(mfa_setup_token) WHERE mfa_setup_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_otp_hash ON users(otp_hash) WHERE otp_hash IS NOT NULL;
