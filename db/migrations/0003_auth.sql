-- Real email/password auth (SPEC §3, §9), task 4. Replaces the interim shared
-- secret on the privileged endpoints with users + bearer sessions.
--
-- Passwords are stored as a PBKDF2 hash string (pbkdf2$iterations$salt$hash),
-- never in the clear. Sessions store only the sha-256 hash of the bearer token
-- (same as sign-off links) — the raw token is returned once at login.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL,          -- site_engineer | qa_qc (§9)
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions (token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
