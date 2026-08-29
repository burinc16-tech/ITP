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
 * exist, matched by the column-id conventions the templates already use
 * (make/model columns stay untouched — the register doesn't hold those):
 *
 *   description | instrument | function ← instrument description (serial
 *                            appended when the table has no serial column)
 *   make                                ← manufacturer
 *   model | make_model                  ← model, with the make joined on as
 *                            `MEGGER/MIT310` unless the table has its own make
 *                            column (the ductwork leakage form is the only one)
 *   serial_no | serial                  ← serial number
 *   cal_cert | cert_no                  ← certificate number
 *   cal_date                            ← date calibrated
 *   cal_due | cal_due_date | due_date   ← calibration due date
 *
 * An EXPIRED instrument is allowed but warned about (decided with the user
 * 2026-08-20) — paperwork sometimes lags reality on site, and a hard block
 * would push engineers back to typing manually, which defeats the register.
 */

const DESCRIPTION_IDS = new Set(["description", "instrument", "function"]);
const MAKE_IDS = new Set(["make"]);
const MODEL_IDS = new Set(["model", "make_model"]);
const SERIAL_IDS = new Set(["serial_no", "serial"]);
const CERT_IDS = new Set(["cal_cert", "cert_no", "cal_cert_no"]);
const DUE_IDS = new Set(["cal_due", "cal_due_date", "due_date"]);

/**
 * Make and model as one string, the way the engineers already type it on the
 * paper forms (`MEGGER/MIT310`). Either half alone is used unchanged.
 */
export function makeModel(instrument: Pick<Instrument, "make" | "model">): string {
  const make = (instrument.make ?? "").trim();
  const model = (instrument.model ?? "").trim();
  return make && model ? `${make}/${model}` : make || model;
}

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

  const description =
    instrument.serial_no && !hasSerialColumn
      ? `${instrument.description} — S/N ${instrument.serial_no}`
      : instrument.description;
  for (const id of DESCRIPTION_IDS) if (ids.has(id)) next[id] = description;
  // A table with its own Make column gets the two halves apart; anywhere else
  // the model cell is the only place the make can appear, so it carries both.
  const hasMakeColumn = [...MAKE_IDS].some((id) => ids.has(id));
  for (const id of MAKE_IDS) if (ids.has(id)) next[id] = instrument.make ?? "";
  for (const id of MODEL_IDS) {
    if (ids.has(id)) next[id] = hasMakeColumn ? (instrument.model ?? "") : makeModel(instrument);
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

/**
 * The column an instrument table hangs its register picker on — the one holding
 * the instrument's name (`description` / `instrument` / `function`), which is
 * what an engineer reaches for first. Undefined when the table has no such
 * column, in which case the section gets no picker.
 */
export function instrumentPickerColumn(
  columns: readonly Pick<ColumnDef, "id" | "type">[],
): string | undefined {
  return columns.find((c) => c.type !== "calculated" && DESCRIPTION_IDS.has(c.id))?.id;
}
