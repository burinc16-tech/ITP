import {
  isMatrixSection,
  isStandardSection,
  type Row,
  type Template,
} from "@schema";
import {
  headRecords,
  templateFor,
  type ChecklistRecord,
  type RecordStatus,
} from "../data/record";
import { evaluateLimit, toNumber } from "./evaluate";
import { buildVarMap, interpolate, type VarMap } from "./interpolate";
import type { RecordValues } from "./values";

/** One failing checklist row, the raw material of the outstanding list (§6). */
export interface OutstandingRow {
  row_id: string;
  no: string | null;
  description: string;
  /** Human-readable failing value, e.g. "Fail", "0.5 MΩ", or a status label. */
  display: string;
  remarks: string;
}

/** An outstanding row tied to the record it came from, for the dashboard. */
export interface OutstandingItem extends OutstandingRow {
  record_id: string;
  template_title: string;
  rev: number;
  serial_no: string | null;
  status: RecordStatus;
}

/** Whether a standard row's stored value evaluates to Fail. */
function rowFails(row: Row, value: string): boolean {
  if (row.type === "pass_fail_na") return value === "fail";
  if (row.type === "status") {
    return (row.states ?? []).some(
      (s) => s.value === value && s.outcome === "fail",
    );
  }
  if (row.type === "number" && row.limit) {
    return evaluateLimit(toNumber(value), row.limit) === "fail";
  }
  return false;
}

/** Display string for a failing standard row. */
function rowDisplay(row: Row, value: string): string {
  if (row.type === "pass_fail_na") return row.labels?.[1] ?? "Fail";
  if (row.type === "status") {
    const state = (row.states ?? []).find((s) => s.value === value);
    return state?.label ?? value;
  }
  return row.unit ? `${value} ${row.unit}` : value;
}

/**
 * The rows of one record that evaluate to Fail (SPEC §6): three-state controls
 * set to Fail, numbers outside their limit, and status rows whose chosen state
 * has a `fail` outcome (which is where "In Progress" maps, §12). Covers standard
 * rows and matrix points; dynamic-table cells are a later pass. Descriptions are
 * interpolated so the item reads with literal values.
 */
export function outstandingRows(
  template: Template,
  values: RecordValues,
): OutstandingRow[] {
  const vars: VarMap = buildVarMap(template.variables, values.variables);
  const out: OutstandingRow[] = [];

  for (const section of template.sections) {
    if (isStandardSection(section)) {
      for (const row of section.rows) {
        const value = values.rows[row.id]?.value ?? "";
        if (!rowFails(row, value)) continue;
        out.push({
          row_id: row.id,
          no: row.no ?? null,
          description: interpolate(row.description, vars),
          display: rowDisplay(row, value),
          remarks: values.rows[row.id]?.remarks ?? "",
        });
      }
    } else if (isMatrixSection(section)) {
      for (const band of section.row_bands) {
        const limit = band.limit ?? section.limit;
        if (!limit) continue;
        for (const point of band.points) {
          const value = values.rows[point.id]?.value ?? "";
          if (evaluateLimit(toNumber(value), limit) !== "fail") continue;
          const unit = band.unit ? ` ${band.unit}` : "";
          out.push({
            row_id: point.id,
            no: null,
            description: `${section.title} — ${band.label}: ${point.label}`,
            display: `${value}${unit}`,
            remarks: values.rows[point.id]?.remarks ?? "",
          });
        }
      }
    }
  }

  return out;
}

/**
 * The outstanding-items list across the store (§6). Derived from the head of
 * each revision chain that is past draft, so a Fail cleared by a later revision
 * (which becomes the new head with the row passing) drops off automatically.
 */
export function outstandingItems(
  records: ChecklistRecord[],
  templates: Template[],
): OutstandingItem[] {
  const items: OutstandingItem[] = [];
  for (const record of headRecords(records)) {
    if (record.status === "draft") continue;
    const template = templateFor(record, templates);
    if (!template) continue;
    for (const row of outstandingRows(template, record.values)) {
      items.push({
        ...row,
        record_id: record.id,
        template_title: template.title,
        rev: record.rev,
        serial_no: record.serial_no,
        status: record.status,
      });
    }
  }
  return items;
}
