-- Calibration register (SPEC §4, §10 screen 9). Until now instruments lived only
-- in the browser that typed them: no route, no table, so a register built on the
-- office PC was invisible on site and a cleared profile took it with it.
--
-- Reference data, not evidence: a certificate gets renewed and the row is edited,
-- so the sync is an upsert by client id (last-write-wins on `updated_at`), the
-- same shape as attachments and unlike the insert-once signature/audit stores.
--
-- Deletes are tombstones, not DELETEs. A row removed on one device has to be able
-- to travel; a hard delete would simply be re-created by the next push from a
-- device that still had it.

CREATE TABLE IF NOT EXISTS instruments (
  id            TEXT PRIMARY KEY,
  serial_no     TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  cal_cert_url  TEXT NOT NULL DEFAULT '',
  cal_date      TEXT NOT NULL DEFAULT '',
  cal_due_date  TEXT NOT NULL DEFAULT '',
  updated_at    TEXT NOT NULL,
  deleted       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_instruments_due ON instruments(cal_due_date);
