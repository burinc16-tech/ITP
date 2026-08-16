-- The certificate number (SPEC §4) — the reference a lab prints on the document
-- and the only handle an auditor can use to ask for the original. Until now the
-- register held the file (`cal_cert_url`) but not the number, so the link read a
-- generic "Certificate" and the number lived nowhere but inside the scan.
--
-- Additive with a default so every existing row stays valid and an older client,
-- which pushes no `cert_no`, keeps writing successfully.

ALTER TABLE instruments ADD COLUMN cert_no TEXT NOT NULL DEFAULT '';
