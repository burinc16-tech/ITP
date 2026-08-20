-- Registry deletes (projects / systems / equipment) travel as tombstones, the
-- same way instrument deletes do: a hard delete on one device would just be
-- re-created by the next push from a device that still held the row, so a
-- removal is an upsert with deleted = 1 and a fresh updated_at instead.
--
-- Additive with a default so every existing row stays valid and an older
-- client, which pushes no `deleted`, keeps writing successfully.

ALTER TABLE projects ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE systems ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE equipment ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
