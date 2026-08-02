-- Remote sign-off (SPEC §6 path B), server task 2a. Adds the columns the
-- sign-off flow needs on top of 0001:
--   * signature_requests.slot_id  — the template signature *slot* the request
--     fills (e.g. "sig_witness"). 0001 stored only the printed `role`; the
--     signatures row written on signing needs the slot id too.
--   * signatures.signer_email / signer_ip — remote_link evidence (§6): the
--     recipient email the link was issued to and the CF-Connecting-IP the
--     signature was submitted from. Null for on-device (path A) signatures.
-- SQLite ADD COLUMN needs a default for NOT NULL, hence slot_id DEFAULT ''.

ALTER TABLE signature_requests ADD COLUMN slot_id TEXT NOT NULL DEFAULT '';

ALTER TABLE signatures ADD COLUMN signer_email TEXT;
ALTER TABLE signatures ADD COLUMN signer_ip TEXT;
