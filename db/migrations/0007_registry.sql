-- The project registry: projects, systems, equipment (SPEC §4, §10 screen 8).
-- Until now this reference data lived only in the browser that typed it
-- (IndexedDB), so a cleared browser or a second device lost the whole registry
-- — and with it the project/system/equipment names on every record row. SPEC
-- §12 places the registry in the client-owned, local-first class that syncs,
-- like the calibration register; these tables are its server copy.
--
-- Upsert by client UUIDv7 id (Hard Rule #2/#3), last-write-wins on
-- `updated_at`, same as `instruments`. No tombstones: the client has no
-- registry delete today, so nothing needs to travel as a deletion.

CREATE TABLE projects (
  id         TEXT PRIMARY KEY,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  client     TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT '',
  closed_at  TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE systems (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL,
  name             TEXT NOT NULL,
  code             TEXT NOT NULL DEFAULT '',
  parent_system_id TEXT,
  updated_at       TEXT NOT NULL
);

CREATE INDEX idx_systems_project ON systems (project_id);

CREATE TABLE equipment (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  system_id   TEXT NOT NULL,
  tag         TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  location    TEXT NOT NULL DEFAULT '',
  drawing_ref TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL
);

CREATE INDEX idx_equipment_project ON equipment (project_id);
