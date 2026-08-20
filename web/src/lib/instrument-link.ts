import type { ColumnDef } from "@schema";
import type { Instrument } from "../data/instrument";
import { calibrationStanding } from "./calibration";
import type { TableRow } from "./values";

/**
 * Record↔instrument linking (SPEC §5 `instruments`, §10 screen 9): filling an
 * instrument table row from the calibration register instead of typing it.
 *
 * The fill is a COPY, never a live link — the signed printout must show what
 * was true on test day even if the register row is later edited or the
 * instrument recalibrated. Values land in whichever of the section's columns
 * exist, matched by the column-id conventions the templates already use:
 *
 *   description            ← instrument description (serial appended when the
 *                            table has no serial column of its own)
 *   serial_no | serial     ← serial number
 *   cal_cert | cert_no     ← certificate number
 *   cal_date               ← date calibrated
 *   cal_due | cal_due_date ← calibration due date
 *
 * An EXPIRED instrument is allowed but warned about (decided with the user
 * 2026-08-20) — paperwork sometimes lags reality on site, and a hard block
 * would push engineers back to typing manually, which defeats the register.
 */

const SERIAL_IDS = new Set(["serial_no", "serial"]);
const CERT_IDS = new Set(["cal_cert", "cert_no", "cal_cert_no"]);
const DUE_IDS = new Set(["cal_due", "cal_due_date"]);

/** One dropdown line: description first (what an engineer scans for), then serial. */
export function instrumentOptionLabel(instrument: Instrument): string {
  const parts = [instrument.description || "(no description)"];
  if (instrument.serial_no) parts.push(`S/N ${instrument.serial_no}`);
  return parts.join(" — ");
}

/**
 * Copy an instrument into a table row. Only columns the section actually has
 * are written; everything else on the row (qty, remarks, …) is untouched.
 */
export function applyInstrumentToRow(
  row: TableRow,
  columns: readonly Pick<ColumnDef, "id" | "type">[],
  instrument: Instrument,
): TableRow {
  const ids = new Set(columns.filter((c) => c.type !== "calculated").map((c) => c.id));
  const hasSerialColumn = [...SERIAL_IDS].some((id) => ids.has(id));
  const next: TableRow = { ...row };

  if (ids.has("description")) {
    next.description =
      instrument.serial_no && !hasSerialColumn
        ? `${instrument.description} — S/N ${instrument.serial_no}`
        : instrument.description;
  }
  for (const id of SERIAL_IDS) if (ids.has(id)) next[id] = instrument.serial_no;
  for (const id of CERT_IDS) if (ids.has(id)) next[id] = instrument.cert_no ?? "";
  if (ids.has("cal_date")) next.cal_date = instrument.cal_date;
  for (const id of DUE_IDS) if (ids.has(id)) next[id] = instrument.cal_due_date;
  return next;
}

/**
 * The register instrument a row refers to, or undefined. Matched by the
 * certificate number first (the auditor's handle), then the serial number —
 * so a manually typed row warns too, not just a picked one. Ambiguity is
 * resolved by first match; blanks never match.
 */
export function matchInstrument(
  row: TableRow,
  columns: readonly Pick<ColumnDef, "id" | "type">[],
  instruments: readonly Instrument[],
): Instrument | undefined {
  const ids = columns.map((c) => c.id);
  const cert = ids.filter((id) => CERT_IDS.has(id)).map((id) => row[id]?.trim()).find(Boolean);
  if (cert) {
    const byCert = instruments.find((i) => (i.cert_no ?? "").trim() === cert);
    if (byCert) return byCert;
  }
  const serial = ids
    .filter((id) => SERIAL_IDS.has(id))
    .map((id) => row[id]?.trim())
    .find(Boolean);
  if (serial) return instruments.find((i) => i.serial_no.trim() === serial);
  return undefined;
}

/**
 * The on-screen warning for an instrument whose calibration has lapsed as of
 * `today` (`YYYY-MM-DD`), or null while it is still covered. Uses the same
 * standing rule as the calibration register (`lib/calibration.ts`).
 */
export function expiredInstrumentWarning(instrument: Instrument, today: string): string | null {
  const { status } = calibrationStanding(instrument.cal_due_date, today);
  if (status !== "expired") return null;
  const due = instrument.cal_due_date || "an unknown date";
  return `Calibration expired ${due}. The result may be challenged — recalibrate or pick another instrument.`;
}
