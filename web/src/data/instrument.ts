/**
 * Test instruments for the calibration register (SPEC §4, §10 screen 9). Like the
 * project registry these are local-first, client-UUIDv7 reference data (Hard Rule
 * #2) that a Project Admin edits, so the repo upserts rather than being
 * append-only.
 *
 * `cal_date` and `cal_due_date` are calendar dates (`YYYY-MM-DD`), not timestamps
 * — a certificate is valid through a day, independent of time zone. Expiry logic
 * lives in `lib/calibration.ts` so the register and its tests share one rule.
 */
export interface Instrument {
  id: string;
  /** Manufacturer serial or asset number — the field an engineer reads off the tool. */
  serial_no: string;
  description: string;
  /** Reference to the calibration certificate (URL or document ref); may be blank. */
  cal_cert_url: string;
  /** Date last calibrated, `YYYY-MM-DD`. */
  cal_date: string;
  /** Date the calibration expires, `YYYY-MM-DD`. */
  cal_due_date: string;
}

export function createInstrument(opts: {
  id: string;
  serialNo: string;
  description?: string;
  calCertUrl?: string;
  calDate: string;
  calDueDate: string;
}): Instrument {
  return {
    id: opts.id,
    serial_no: opts.serialNo,
    description: opts.description ?? "",
    cal_cert_url: opts.calCertUrl ?? "",
    cal_date: opts.calDate,
    cal_due_date: opts.calDueDate,
  };
}
