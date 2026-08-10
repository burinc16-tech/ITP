import type { ColumnDef, DynamicTableSection, Totals } from "@schema";
import {
  aggregateColumn,
  evaluateFormula,
  formatComputed,
  type FormulaScope,
} from "./formula";
import type { TableGroup, TableRow } from "./values";

/**
 * Derived values for a dynamic table's computed cells and totals (SPEC §12) —
 * grouped (per-group totals, the VAV report) and flat (one totals line over all
 * rows, the CHW FCU air balancing form) alike.
 *
 * Both the on-screen form and the print view render from here, so a percentage
 * an engineer sees while filling is by construction the percentage that prints on
 * the signed document. Nothing in this module names a specific template.
 */

/** The display text of a `calculated` cell in one body row. */
export function computeCell(column: ColumnDef, row: TableRow): string {
  if (column.type !== "calculated" || !column.formula) return "";
  const value = evaluateFormula(column.formula, row as FormulaScope);
  return formatComputed(value, {
    decimals: column.decimals,
    unit: column.unit,
  });
}

/**
 * The totals line for one group, keyed by column id.
 *
 * Aggregates are taken over the group's raw body cells; a formula cell is then
 * evaluated against those aggregates, so `balanced / design * 100` means
 * "percentage of the totals" on the totals row and "percentage of this row" on a
 * body row — the same expression, the arithmetic the source form does.
 */
export function computeTotals(
  section: DynamicTableSection,
  group: TableGroup,
): Record<string, string> {
  const totals = section.row_group?.totals;
  if (!totals) return {};
  return totalsOver(totals, section.columns, group.rows);
}

/**
 * The totals line under a FLAT table, aggregated over all its rows (SPEC §12) —
 * same arithmetic as a group's totals, the whole table being the one "group".
 */
export function computeFlatTotals(
  section: DynamicTableSection,
  rows: TableRow[],
): Record<string, string> {
  if (!section.totals) return {};
  return totalsOver(section.totals, section.columns, rows);
}

function totalsOver(
  totals: Totals,
  columns: ColumnDef[],
  rows: TableRow[],
): Record<string, string> {
  const defaultAggregate = totals.default_aggregate ?? "sum";
  const scope: FormulaScope = Object.create(null) as FormulaScope;
  for (const column of columns) {
    const explicit = totals.cells.find((c) => c.column === column.id);
    // A `calculated` column has no stored cells — its values are derived per row
    // — so aggregate what each row computes, not the empty raw cell. Without this
    // a `sum` down a calculated column reads all-blank and totals to nothing (the
    // duct leakage form sums an Area column that is periphery x length).
    // Aggregate-then-derive stays available: name the column with a `formula`
    // instead, which evaluates against the aggregates (the air balancing forms'
    // percentage totals).
    const cells =
      column.type === "calculated" && column.formula
        ? rows.map((r) => evaluateFormula(column.formula!, r as FormulaScope))
        : rows.map((r) => r[column.id]);
    scope[column.id] = aggregateColumn(
      explicit?.aggregate ?? defaultAggregate,
      cells,
    );
  }

  const out: Record<string, string> = {};
  for (const cell of totals.cells) {
    const column = columns.find((c) => c.id === cell.column);
    const value = cell.formula
      ? evaluateFormula(cell.formula, scope)
      : (scope[cell.column] as number | null);
    // Precision follows the column, but the unit does not: the column header
    // already carries it, and the source form's totals are bare numbers. A cell
    // that wants a suffix (the percentage) says so explicitly.
    out[cell.column] = formatComputed(value, {
      decimals: cell.decimals ?? column?.decimals,
      unit: cell.unit,
    });
  }
  return out;
}

/** Column ids a newly added row copies down from the row above it. */
export function seedColumns(section: DynamicTableSection): string[] {
  return section.columns.filter((c) => c.carry_down).map((c) => c.id);
}
