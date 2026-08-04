-- Photo attachments (SPEC §4, §8). The image bytes live in R2 (image_key); the
-- metadata lives here. Unlike signatures (insert-once evidence), an attachment is
-- editable while its record is a draft — a caption can change — so the sync is an
-- upsert by client id (last-write-wins). The endpoint only rewrites the R2 blob
-- when the image bytes actually differ, so a caption-only re-push is cheap.

CREATE TABLE IF NOT EXISTS attachments (
  id          TEXT PRIMARY KEY,
  record_id   TEXT NOT NULL,
  field_id    TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'photo',
  image_key   TEXT NOT NULL,
  caption     TEXT NOT NULL DEFAULT '',
  device_id   TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attachments_record ON attachments(record_id);
