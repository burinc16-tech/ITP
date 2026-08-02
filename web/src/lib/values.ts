import {
  isDynamicTableSection,
  isFieldGroupSection,
  isMatrixSection,
  isStandardSection,
  type DynamicTableSection,
  type Template,
} from "@schema";
import { buildVarMap, interpolate } from "./interpolate";

/**
 * The record's captured values. Everything is stored as strings — the shape the
 * form inputs produce and the shape that serialises cleanly to Dexie/JSON later.
 * Numbers are parsed only when evaluated (see `evaluate.ts`); three-state
 * controls store the semantic state (`"pass" | "fail" | "na"`), never the
 * displayed words, so a template label change never rewrites existing records.
 */
export interface RecordValues {
  variables: Record<string, string>;
  /** Scalar single-value fields, keyed by id: header fields and field_group fields. */
  header: Record<string, string>;
  /** Single-control values keyed by id: standard rows and matrix points. */
  rows: Record<string, RowValue>;
  tables: Record<string, TableRow[]>;
  /** Engineer-appended ad-hoc rows, keyed by section id (SPEC §12). */
  added: Record<string, AddedRow[]>;
}

export interface RowValue {
  value: string;
  remarks: string;
}

export type TableRow = Record<string, string>;

/**
 * An ad-hoc row an engineer appended to a section flagged `allow_add_rows`. Its
 * text is record data, never template wording, so Hard Rule #5 / §5.1 holds.
 */
export interface AddedRow {
  id: string;
  no: string;
  group: string;
  description: string;
  value: string;
  remarks: string;
}

let addedRowCounter = 0;

/** A form-local unique id for an appended row (not a record identifier). */
function newAddedRowId(): string {
  addedRowCounter += 1;
  return `add-${Date.now().toString(36)}-${addedRowCounter.toString(36)}`;
}

/** A blank record for a template, seeded with variable/header/table defaults. */
export function emptyValues(template: Template): RecordValues {
  const variables: Record<string, string> = {};
  for (const v of template.variables ?? []) {
    variables[v.id] = v.default === undefined ? "" : String(v.default);
  }

  const vars = buildVarMap(template.variables, variables);
  const header: Record<string, string> = {};
  for (const f of template.header.fields) {
    if (f.default_from) header[f.id] = interpolate(f.default_from, vars);
    else if (f.default !== undefined) header[f.id] = String(f.default);
    else header[f.id] = "";
  }

  const rows: Record<string, RowValue> = {};
  const tables: Record<string, TableRow[]> = {};
  for (const section of template.sections) {
    if (isDynamicTableSection(section)) {
      tables[section.id] = initialTableRows(section);
    } else if (isStandardSection(section)) {
      for (const row of section.rows) rows[row.id] = { value: "", remarks: "" };
    } else if (isMatrixSection(section)) {
      for (const band of section.row_bands)
        for (const point of band.points)
          rows[point.id] = { value: "", remarks: "" };
    } else if (isFieldGroupSection(section)) {
      for (const f of section.fields) {
        if (f.default_from) header[f.id] = interpolate(f.default_from, vars);
        else if (f.default !== undefined) header[f.id] = String(f.default);
        else header[f.id] = "";
      }
    }
    // sign_off carries no fillable values (signature capture is Phase 3).
  }

  return { variables, header, rows, tables, added: {} };
}

// --- Ad-hoc appended rows -------------------------------------------------

export function addChecklistRow(
  values: RecordValues,
  sectionId: string,
): RecordValues {
  const list = values.added[sectionId] ?? [];
  const row: AddedRow = {
    id: newAddedRowId(),
    no: "",
    group: "",
    description: "",
    value: "",
    remarks: "",
  };
  return {
    ...values,
    added: { ...values.added, [sectionId]: [...list, row] },
  };
}

export function setAddedRowField(
  values: RecordValues,
  sectionId: string,
  rowId: string,
  field: "no" | "group" | "description" | "value" | "remarks",
  value: string,
): RecordValues {
  const list = values.added[sectionId] ?? [];
  const next = list.map((r) => (r.id === rowId ? { ...r, [field]: value } : r));
  return { ...values, added: { ...values.added, [sectionId]: next } };
}

export function removeChecklistRow(
  values: RecordValues,
  sectionId: string,
  rowId: string,
): RecordValues {
  const list = values.added[sectionId] ?? [];
  return {
    ...values,
    added: { ...values.added, [sectionId]: list.filter((r) => r.id !== rowId) },
  };
}

function emptyTableRow(section: DynamicTableSection): TableRow {
  const row: TableRow = {};
  for (const col of section.columns) row[col.id] = "";
  return row;
}

function initialTableRows(section: DynamicTableSection): TableRow[] {
  const rows: TableRow[] = [];
  for (const pre of section.prefilled_rows ?? []) {
    const row: TableRow = {};
    for (const col of section.columns) {
      const cell = pre[col.id];
      row[col.id] = cell === undefined ? "" : String(cell);
    }
    rows.push(row);
  }
  const min = section.min_rows ?? 0;
  while (rows.length < min) rows.push(emptyTableRow(section));
  return rows;
}

// --- Immutable updates ----------------------------------------------------

export function setVariable(
  values: RecordValues,
  id: string,
  value: string,
): RecordValues {
  return { ...values, variables: { ...values.variables, [id]: value } };
}

export function setHeader(
  values: RecordValues,
  id: string,
  value: string,
): RecordValues {
  return { ...values, header: { ...values.header, [id]: value } };
}

export function setRowValue(
  values: RecordValues,
  rowId: string,
  value: string,
): RecordValues {
  const current = values.rows[rowId] ?? { value: "", remarks: "" };
  return { ...values, rows: { ...values.rows, [rowId]: { ...current, value } } };
}

export function setRowRemarks(
  values: RecordValues,
  rowId: string,
  remarks: string,
): RecordValues {
  const current = values.rows[rowId] ?? { value: "", remarks: "" };
  return {
    ...values,
    rows: { ...values.rows, [rowId]: { ...current, remarks } },
  };
}

export function setTableCell(
  values: RecordValues,
  sectionId: string,
  index: number,
  columnId: string,
  value: string,
): RecordValues {
  const table = values.tables[sectionId] ?? [];
  const next = table.map((row, i) =>
    i === index ? { ...row, [columnId]: value } : row,
  );
  return { ...values, tables: { ...values.tables, [sectionId]: next } };
}

export function addTableRow(
  values: RecordValues,
  section: DynamicTableSection,
): RecordValues {
  const table = values.tables[section.id] ?? [];
  return {
    ...values,
    tables: {
      ...values.tables,
      [section.id]: [...table, emptyTableRow(section)],
    },
  };
}

/** Remove a table row, but never below the section's `min_rows` floor. */
export function removeTableRow(
  values: RecordValues,
  section: DynamicTableSection,
  index: number,
): RecordValues {
  const table = values.tables[section.id] ?? [];
  if (table.length <= (section.min_rows ?? 0)) return values;
  return {
    ...values,
    tables: {
      ...values.tables,
      [section.id]: table.filter((_, i) => i !== index),
    },
  };
}
