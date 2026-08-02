-- Initial D1 schema (SPEC §4). Records carry their full JSON in `body`; a few
-- columns are promoted for indexing and last-write-wins. Signatures reference an
-- R2 object by key (blobs never live in D1). signature_requests is defined now
-- for the remote sign-off task even though it is unused in this foundation step.

CREATE TABLE IF NOT EXISTS records (
  id                  TEXT PRIMARY KEY,
  template_version_id TEXT NOT NULL,
  status              TEXT NOT NULL,
  project_id          TEXT,
  updated_at          TEXT NOT NULL,
  body                TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_records_project ON records (project_id);
CREATE INDEX IF NOT EXISTS idx_records_status ON records (status);

CREATE TABLE IF NOT EXISTS signatures (
  id             TEXT PRIMARY KEY,
  record_id      TEXT NOT NULL,
  slot_id        TEXT NOT NULL,
  role           TEXT NOT NULL,
  name           TEXT NOT NULL,
  company        TEXT NOT NULL,
  method         TEXT NOT NULL,
  signed_by_user TEXT,
  device_id      TEXT NOT NULL,
  image_key      TEXT NOT NULL,
  signed_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_signatures_record ON signatures (record_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id        TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  user      TEXT,
  role      TEXT NOT NULL,
  action    TEXT NOT NULL,
  before    TEXT,
  after     TEXT,
  reason    TEXT,
  at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_record ON audit_log (record_id);

CREATE TABLE IF NOT EXISTS signature_requests (
  id                     TEXT PRIMARY KEY,
  record_id              TEXT NOT NULL,
  role                   TEXT NOT NULL,
  recipient_name         TEXT,
  recipient_email        TEXT NOT NULL,
  token_hash             TEXT NOT NULL,
  status                 TEXT NOT NULL,
  sent_at                TEXT,
  opened_at              TEXT,
  closed_at              TEXT,
  expires_at             TEXT NOT NULL,
  reject_reason          TEXT,
  record_version_at_send TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sigreq_record ON signature_requests (record_id);
CREATE INDEX IF NOT EXISTS idx_sigreq_token ON signature_requests (token_hash);
