-- Make and model for a register instrument (SPEC §4). Every instrument table on
-- the forms has a make/model column, but the register held only description,
-- serial and certificate — so picking an instrument filled the row and then left
-- the engineer to type "MEGGER/MIT310" by hand on every record.
--
-- Two columns rather than one: the ductwork leakage form asks for Make and Model
-- separately, and a joined string cannot be split back apart reliably.
--
-- Additive with defaults so every existing row stays valid and an older client,
-- which pushes neither column, keeps writing successfully.

ALTER TABLE instruments ADD COLUMN make TEXT NOT NULL DEFAULT '';
ALTER TABLE instruments ADD COLUMN model TEXT NOT NULL DEFAULT '';
