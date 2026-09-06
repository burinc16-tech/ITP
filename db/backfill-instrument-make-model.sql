-- One-off backfill: make/model for the register rows that predate migration 0009.
-- Every value below is read off that instrument's own calibration certificate in
-- /calibration-certs. updated_at is bumped so each device pulls the change on its
-- next sync. Safe to re-run.
--
-- APPLIED to the remote D1 on 2026-08-29 (13 rows). Kept as the record of where
-- these values came from — not pending work. Three instruments are deliberately
-- absent: the Digital Force Gauge (5815C10516), IR Thermometer (E1034007017) and
-- Sound Level Meter (240404626), whose certificates could not be read; those are
-- to be filled by hand in the Calibration register screen.

UPDATE instruments SET make = 'TSI-AIRFLOW', model = 'TA465-P', updated_at = '2026-08-29T07:57:56.786Z' WHERE serial_no = 'TA4651314007' AND deleted = 0;
UPDATE instruments SET make = 'KYORITSU', model = 'KEW SNAP 2027', updated_at = '2026-08-29T07:57:56.786Z' WHERE serial_no = 'W8045321' AND deleted = 0;
UPDATE instruments SET make = 'MEGGER', model = 'MIT310', updated_at = '2026-08-29T07:57:56.786Z' WHERE serial_no = '102109639' AND deleted = 0;
UPDATE instruments SET make = 'CENTER', model = '531', updated_at = '2026-08-29T07:57:56.786Z' WHERE serial_no = '210808767' AND deleted = 0;
UPDATE instruments SET make = 'MEGGER', model = 'LTW315', updated_at = '2026-08-29T07:57:56.786Z' WHERE serial_no = '102124600' AND deleted = 0;
UPDATE instruments SET make = 'TSI-AIRFLOW', model = 'PVM610', updated_at = '2026-08-29T07:57:56.786Z' WHERE serial_no = 'PVM612002003' AND deleted = 0;
UPDATE instruments SET make = 'KYORITSU', model = '8031', updated_at = '2026-08-29T07:57:56.786Z' WHERE serial_no = 'E0193127' AND deleted = 0;
UPDATE instruments SET make = 'SCOTTS', model = '', updated_at = '2026-08-29T07:57:56.786Z' WHERE serial_no = 'EK22004280997' AND deleted = 0;
UPDATE instruments SET make = 'AS-SAFE', model = '', updated_at = '2026-08-29T07:57:56.786Z' WHERE serial_no = 'BE11 23019' AND deleted = 0;
UPDATE instruments SET make = 'AS-SAFE', model = '', updated_at = '2026-08-29T07:57:56.786Z' WHERE serial_no = 'BF01 21314' AND deleted = 0;
UPDATE instruments SET make = 'MEGGER', model = 'RCDT310', updated_at = '2026-08-29T07:57:56.786Z' WHERE serial_no = '102228940' AND deleted = 0;
UPDATE instruments SET make = 'KING TONY', model = '34362-3DG', updated_at = '2026-08-29T07:57:56.786Z' WHERE serial_no = '1901620342' AND deleted = 0;
UPDATE instruments SET make = 'FLUKE', model = '115', updated_at = '2026-08-29T07:57:56.786Z' WHERE serial_no = '43452638WS' AND deleted = 0;
