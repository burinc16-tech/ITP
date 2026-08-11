import { isSignOffSection, type Signature, type Template } from "@schema";
import type { ChecklistRecord } from "../data/record";
import { formatSignedAt, type SignatureView } from "../data/signature";
import type { RecordValues } from "./values";

/**
 * Data model for the opt-in Inspection Request (RFI) cover page (SPEC §12,
 * handover 2026-08-05 task 2). ONE shared cover, driven by record/template data
 * — never per-template markup (Hard Rule #4). The reference layout is
 * `spec/reference/inspection-request-form.html`.
 *
 * Fields split three ways:
 *  - App-filled and user-editable at the print step (`RfiCoverOptions`): the
 *    app pre-fills a sensible default from the template/record, but the user's
 *    edit wins and is what prints.
 *  - App-derived, not editable: the contractor sign-off (name/date/signature
 *    image come from the record's captured contractor signature).
 *  - Manual on-site (left blank on the print for handwriting): IRF No., Scope /
 *    Remarks, Inspection Result, and the Inspector / Engineer sign-off.
 */

/** The declaration paragraph, verbatim from the reference form. */
export const RFI_DECLARATION =
  "We, the Main Contractor / Contractor / Nominated Sub-Contractor / Sub-Contractor " +
  "have already carried out Preliminary Inspections of the works to ensure that they " +
  "are in accordance with the Specification, Scope of Works, and Contract documentation " +
  "requirements and that the works are complete and ready for Inspection.";

/** Discipline options, in the order they appear on the reference form. */
export const RFI_DISCIPLINES = [
  { value: "acmv", label: "ACMV" },
  { value: "electrical", label: "Electrical" },
  { value: "fire", label: "Fire Protection" },
  { value: "ps", label: "P&S" },
  { value: "other", label: "Other" },
] as const;

export type RfiDiscipline = (typeof RFI_DISCIPLINES)[number]["value"];

export const RFI_DRAWING_NO_DEFAULT = "Please refer to the attachment";
export const RFI_CONTRACTOR_DEFAULT = "Kenyon";

/** User-editable cover fields, seeded from the record but overridable at print. */
export interface RfiCoverOptions {
  project: string;
  contractor: string;
  drawingNo: string;
  floor: string;
  area: string;
  /** Display date string (dd/mm/yyyy), pre-filled from the record. */
  date: string;
  activity: string;
  ref: string;
  /** USER-CHOSEN discipline (SPEC §12) — not auto-bound to the template. */
  discipline: RfiDiscipline;
  /** Free text shown/printed only when `discipline === "other"`. */
  otherText: string;
}

/** The contractor sign-off as printed: pulled from the record's signature. */
export interface RfiContractorSignOff {
  name: string;
  date: string;
  imageUrl: string | null;
}

/** Everything the cover component prints — options plus app-derived pieces. */
export interface RfiCoverData extends RfiCoverOptions {
  declaration: string;
  contractorSignOff: RfiContractorSignOff | null;
}

/**
 * The value of the first header field whose id or label mentions any keyword,
 * or "" when none is filled. Best-effort across heterogeneous templates — the
 * cover never assumes a fixed field id (Hard Rule #4).
 */
function headerByKeyword(
  template: Template,
  values: RecordValues,
  keywords: string[],
): string {
  for (const field of template.header.fields) {
    const hay = `${field.id} ${field.label}`.toLowerCase();
    if (keywords.some((k) => hay.includes(k))) {
      const v = values.header[field.id];
      if (v) return v;
    }
  }
  return "";
}

/** dd/mm/yyyy in Asia/Singapore for an ISO date (`YYYY-MM-DD`) or datetime. */
export function formatCoverDate(iso: string): string {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return formatSignedAt(iso).split(" ")[0] ?? iso;
}

/** The record date to print: a `date` header field if filled, else created_at. */
function coverDate(template: Template, values: RecordValues, record: ChecklistRecord): string {
  for (const field of template.header.fields) {
    if (field.type === "date") {
      const v = values.header[field.id];
      if (v) return formatCoverDate(v);
    }
  }
  return formatCoverDate(record.created_at);
}

/** Map the template's discipline string onto a sensible default radio choice. */
export function defaultDiscipline(template: Template): RfiDiscipline {
  const d = template.discipline.toLowerCase();
  if (d.includes("electric")) return "electrical";
  if (d.includes("fire")) return "fire";
  if (d.includes("mech") || d.includes("acmv") || d.includes("hvac")) return "acmv";
  if (d.includes("plumb") || d.includes("sanitary") || d.includes("p&s")) return "ps";
  return "other";
}

/** All signature slots a template declares — footer plus any sign_off sections. */
function allSignatureSlots(template: Template): Signature[] {
  const slots: Signature[] = [...(template.footer?.signatures ?? [])];
  for (const section of template.sections) {
    if (isSignOffSection(section)) slots.push(...section.signatures);
  }
  return slots;
}

/** The captured contractor signature for the cover, or null if none is captured. */
function contractorSignOff(
  template: Template,
  signatures: Map<string, SignatureView>,
): RfiContractorSignOff | null {
  const slots = allSignatureSlots(template);
  const slot = slots.find((s) => s.stage === "contractor") ?? slots[0];
  if (!slot) return null;
  const captured = signatures.get(slot.id);
  if (!captured) return null;
  return {
    name: captured.name,
    date: formatCoverDate(captured.signed_at),
    imageUrl: captured.image_url,
  };
}

/**
 * Seed the editable cover options from the record. The app pre-selects a
 * discipline from the template, but the user's choice at the print step wins
 * (SPEC §12). Floor/Area/Project are best-effort from header fields; a template
 * that carries none simply yields blank, editable boxes.
 */
export function defaultCoverOptions(
  template: Template,
  values: RecordValues,
  record: ChecklistRecord,
): RfiCoverOptions {
  const equipment = headerByKeyword(template, values, ["equipment", "panel", "db "]);
  const activity = equipment ? `${template.title} — ${equipment}` : template.title;
  return {
    project: headerByKeyword(template, values, ["project"]),
    contractor: RFI_CONTRACTOR_DEFAULT,
    drawingNo: RFI_DRAWING_NO_DEFAULT,
    floor: headerByKeyword(template, values, ["floor", "level"]),
    area: headerByKeyword(template, values, ["area"]),
    date: coverDate(template, values, record),
    activity,
    ref: record.serial_no ?? "",
    discipline: defaultDiscipline(template),
    otherText: "",
  };
}

/** Assemble the full cover data from user options plus app-derived pieces. */
export function buildRfiCoverData(
  template: Template,
  signatures: Map<string, SignatureView>,
  options: RfiCoverOptions,
): RfiCoverData {
  return {
    ...options,
    declaration: RFI_DECLARATION,
    contractorSignOff: contractorSignOff(template, signatures),
  };
}
