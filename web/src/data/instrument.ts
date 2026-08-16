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
  /**
   * Certificate number as printed by the issuing lab (`BLE2604334-2`,
   * `PLS-26010053-01`, …) — the handle an auditor quotes when asking for the
   * original document. Optional so rows written before the register carried it
   * still load; the register falls back to a generic link label when blank.
   */
  cert_no?: string;
  /** Date last calibrated, `YYYY-MM-DD`. */
  cal_date: string;
  /** Date the calibration expires, `YYYY-MM-DD`. */
  cal_due_date: string;
  /**
   * UTC ISO timestamp of the last edit (Hard Rule #3). Carried on every push so
   * the server can drop a stale write from a device that has been offline since
   * before the row changed. Optional so rows written before the register synced
   * still load; treat a missing value as the epoch — anything else wins over it.
   */
  updated_at?: string;
  /**
   * Tombstone. A removal has to travel between devices, so a deleted row is kept
   * and flagged rather than dropped — a hard delete would be re-created by the
   * next push from a device that still held it. Filtered out of `list()`.
   */
  deleted?: boolean;
}

export function createInstrument(opts: {
  id: string;
  serialNo: string;
  description?: string;
  calCertUrl?: string;
  certNo?: string;
  calDate: string;
  calDueDate: string;
  updatedAt?: string;
  deleted?: boolean;
}): Instrument {
  return {
    id: opts.id,
    serial_no: opts.serialNo,
    description: opts.description ?? "",
    cal_cert_url: opts.calCertUrl ?? "",
    cert_no: opts.certNo ?? "",
    cal_date: opts.calDate,
    cal_due_date: opts.calDueDate,
    updated_at: opts.updatedAt ?? new Date().toISOString(),
    deleted: opts.deleted ?? false,
  };
}
