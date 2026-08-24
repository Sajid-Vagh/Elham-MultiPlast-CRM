-- Migration 082: Auth Security Upgrade
-- Adds: email-based auth, session expiry, account lockout, Google OAuth,
--        password reset, email verification, user invitations
-- SAFE: All columns nullable or with defaults — zero impact on existing rows.

-- ============================================================
-- 1. Users table — new columns
-- ============================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_token text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_expires_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_expires_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- Unique constraint on email (nullable — only enforced for non-null values)
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx ON users (email) WHERE email IS NOT NULL;
-- Unique constraint on google_id (nullable)
CREATE UNIQUE INDEX IF NOT EXISTS users_google_id_unique_idx ON users (google_id) WHERE google_id IS NOT NULL;

-- ============================================================
-- 2. Sessions table — new columns
-- ============================================================
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days');
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ip_address text;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_agent text;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_used_at timestamptz;

-- ============================================================
-- 3. Invitations table (new)
-- ============================================================
CREATE TABLE IF NOT EXISTS invitations (
  id serial PRIMARY KEY,
  email text NOT NULL,
  token text NOT NULL UNIQUE,
  role text NOT NULL,
  unit text NOT NULL DEFAULT 'All',
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations (token);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations (email);

-- ============================================================
-- 4. Backfill: give existing users a placeholder email based on username
--    (safe — email is nullable, won't conflict)
-- ============================================================
-- NOTE: We do NOT backfill emails automatically. Existing users will need
-- the admin to set their email via Settings or they can keep using username login.
