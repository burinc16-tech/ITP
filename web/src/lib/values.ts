import {
  isDynamicTableSection,
  isFieldGroupSection,
  isMatrixSection,
  isStandardSection,
  type ColumnDef,
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
  /**
   * Rows of a grouped dynamic table, keyed by section id (SPEC §12). Optional
   * because records written before grouped tables existed simply do not carry it
   * — read it through `groupsFor`, never by direct index.
   */
  groups?: Record<string, TableGroup[]>;
  /**
   * Column ids currently present on a flat table that allows engineer-added
   * columns (`add_columns`, SPEC §12), keyed by section id and in printed order.
   * Optional: a record that has never touched its columns simply does not carry
   * it, and reads fall back to the template's own list — so every record written
   * before the feature existed still renders. Read it through `columnsFor`.
   */
  columns?: Record<string, string[]>;
}

/**
 * One group of a grouped dynamic table: the group-level field values (rendered
 * in the spanning cells) and the body rows beneath them.
 */
export interface TableGroup {
  fields: TableRow;
  rows: TableRow[];
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
  const groups: Record<string, TableGroup[]> = {};
  for (const section of template.sections) {
    if (isDynamicTableSection(section)) {
      if (section.row_group) groups[section.id] = initialGroups(section);
      else tables[section.id] = initialTableRows(section);
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

  return { variables, header, rows, tables, added: {}, groups };
}

// --- Grouped dynamic tables (SPEC §12) ------------------------------------

/** Groups of a section, tolerating records written before grouping existed. */
export function groupsFor(
  values: RecordValues,
  sectionId: string,
): TableGroup[] {
  return values.groups?.[sectionId] ?? [];
}

function emptyGroup(section: DynamicTableSection): TableGroup {
  const group = section.row_group;
  const fields: TableRow = {};
  for (const col of group?.columns ?? []) fields[col.id] = "";
  const count = group?.rows_per_new_group ?? 1;
  const rows: TableRow[] = [];
  for (let i = 0; i < count; i += 1) rows.push(emptyTableRow(section));
  return { fields, rows };
}

function initialGroups(section: DynamicTableSection): TableGroup[] {
  const groups: TableGroup[] = [];
  const min = section.row_group?.min_groups ?? 1;
  while (groups.length < min) groups.push(emptyGroup(section));
  return groups;
}

function writeGroups(
  values: RecordValues,
  sectionId: string,
  next: TableGroup[],
): RecordValues {
  return {
    ...values,
    groups: { ...(values.groups ?? {}), [sectionId]: next },
  };
}

/** Update one group-level field (a spanning cell, e.g. the VAV tag). */
export function setGroupField(
  values: RecordValues,
  sectionId: string,
  groupIndex: number,
  columnId: string,
  value: string,
): RecordValues {
  const next = groupsFor(values, sectionId).map((g, i) =>
    i === groupIndex ? { ...g, fields: { ...g.fields, [columnId]: value } } : g,
  );
  return writeGroups(values, sectionId, next);
}

/** Update one body cell within a group. */
export function setGroupCell(
  values: RecordValues,
  sectionId: string,
  groupIndex: number,
  rowIndex: number,
  columnId: string,
  value: string,
): RecordValues {
  const next = groupsFor(values, sectionId).map((g, i) =>
    i === groupIndex
      ? {
          ...g,
          rows: g.rows.map((r, j) =>
            j === rowIndex ? { ...r, [columnId]: value } : r,
          ),
        }
      : g,
  );
  return writeGroups(values, sectionId, next);
}

export function addGroup(
  values: RecordValues,
  section: DynamicTableSection,
): RecordValues {
  const next = [...groupsFor(values, section.id), emptyGroup(section)];
  return writeGroups(values, section.id, next);
}

/** Remove a group, but never below the section's `min_groups` floor. */
export function removeGroup(
  values: RecordValues,
  section: DynamicTableSection,
  groupIndex: number,
): RecordValues {
  const current = groupsFor(values, section.id);
  if (current.length <= (section.row_group?.min_groups ?? 1)) return values;
  return writeGroups(
    values,
    section.id,
    current.filter((_, i) => i !== groupIndex),
  );
}

/**
 * Append a body row to a group, seeded from the row above it. The source form
 * copies the service area and diffuser type down, which is what an engineer
 * adding the next diffuser on the same run almost always wants.
 */
export function addGroupRow(
  values: RecordValues,
  section: DynamicTableSection,
  groupIndex: number,
  seedFrom?: readonly string[],
): RecordValues {
  const next = groupsFor(values, section.id).map((g, i) => {
    if (i !== groupIndex) return g;
    const previous = g.rows[g.rows.length - 1];
    const row = emptyTableRow(section);
    for (const columnId of seedFrom ?? [])
      row[columnId] = previous?.[columnId] ?? "";
    return { ...g, rows: [...g.rows, row] };
  });
  return writeGroups(values, section.id, next);
}

/** Remove a body row from a group; a group always keeps at least one row. */
export function removeGroupRow(
  values: RecordValues,
  section: DynamicTableSection,
  groupIndex: number,
  rowIndex: number,
): RecordValues {
  const next = groupsFor(values, section.id).map((g, i) =>
    i !== groupIndex || g.rows.length <= 1
      ? g
      : { ...g, rows: g.rows.filter((_, j) => j !== rowIndex) },
  );
  return writeGroups(values, section.id, next);
}

// --- Ad-hoc appended rows -------------------------------------------------

/**
 * Append a blank ad-hoc row. `id` is supplied by the caller (a UUIDv7 from the
 * form's injected `newId`, SPEC §4 / Hard Rule #2) — this stays a pure transform,
 * matching how `createDraft`/`createSignature` take their id rather than minting
 * one. The id is persisted in `Record.values.added` and snapshotted, so it must
 * be globally unique, not a per-session counter that collides across devices.
 */
export function addChecklistRow(
  values: RecordValues,
  sectionId: string,
  id: string,
): RecordValues {
  const list = values.added[sectionId] ?? [];
  const row: AddedRow = {
    id,
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

/**
 * Replace one table row wholesale — used when several cells change in one
 * action, e.g. filling an instrument row from the calibration register.
 */
export function setTableRow(
  values: RecordValues,
  sectionId: string,
  index: number,
  row: TableRow,
): RecordValues {
  const table = values.tables[sectionId] ?? [];
  const next = table.map((existing, i) => (i === index ? row : existing));
  return { ...values, tables: { ...values.tables, [sectionId]: next } };
}

/**
 * The columns a flat table currently shows: the record's own list when the
 * engineer has added or deleted any, the template's otherwise.
 *
 * Labels are POSITIONAL for a section that allows added columns — the third
 * column reads "Test Point 3" whatever its id — so deleting one renumbers the
 * rest exactly as the source sheets do, while the ids (and therefore the stored
 * cell values) stay put.
 */
export function columnsFor(
  values: RecordValues,
  section: DynamicTableSection,
): ColumnDef[] {
  const spec = section.add_columns;
  if (!spec) return section.columns;

  const ids = values.columns?.[section.id] ?? section.columns.map((c) => c.id);
  return ids.map((id, index) => {
    const fromTemplate = section.columns.find((c) => c.id === id);
    return {
      ...(fromTemplate ?? {}),
      id,
      label: `${spec.label_prefix} ${index + 1}`,
      type: fromTemplate?.type ?? spec.type,
      unit: fromTemplate?.unit ?? spec.unit,
      width: fromTemplate?.width ?? spec.width,
      align: fromTemplate?.align ?? spec.align,
    } as ColumnDef;
  });
}

/** Append one column, with the lowest id the section is not already using. */
export function addTableColumn(
  values: RecordValues,
  section: DynamicTableSection,
): RecordValues {
  const spec = section.add_columns;
  if (!spec) return values;
  const ids = values.columns?.[section.id] ?? section.columns.map((c) => c.id);
  // Never reuse an id still in play: a recycled id would inherit the deleted
  // column's leftover cell values on any row that was not cleared.
  let n = ids.length + 1;
  while (ids.includes(`${spec.id_prefix}${n}`)) n += 1;
  return {
    ...values,
    columns: { ...values.columns, [section.id]: [...ids, `${spec.id_prefix}${n}`] },
  };
}

/**
 * Delete one column and the readings under it. Refuses to go below `min_count`
 * (default 1) — a table with no columns is not a table.
 */
export function removeTableColumn(
  values: RecordValues,
  section: DynamicTableSection,
  columnId: string,
): RecordValues {
  const spec = section.add_columns;
  if (!spec) return values;
  const ids = values.columns?.[section.id] ?? section.columns.map((c) => c.id);
  if (ids.length <= (spec.min_count ?? 1)) return values;
  if (!ids.includes(columnId)) return values;

  const table = values.tables[section.id] ?? [];
  const stripped = table.map((row) => {
    const { [columnId]: _removed, ...rest } = row;
    return rest;
  });

  return {
    ...values,
    columns: { ...values.columns, [section.id]: ids.filter((id) => id !== columnId) },
    tables: { ...values.tables, [section.id]: stripped },
  };
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
