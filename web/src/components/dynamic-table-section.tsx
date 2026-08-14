import type { ReactNode } from "react";
import type { DynamicTableSection as DynamicTableSectionDef } from "@schema";
import {
  computeCell,
  computeFlatTotals,
  computeTotals,
  seedColumns,
} from "../lib/grouped-table";
import {
  addGroup,
  addGroupRow,
  addTableColumn,
  addTableRow,
  columnsFor,
  groupsFor,
  removeGroup,
  removeGroupRow,
  removeTableColumn,
  removeTableRow,
  setGroupCell,
  setGroupField,
  setTableCell,
} from "../lib/values";
import { FieldControl } from "./field-control";
import { useForm } from "./form-context";

/** A section whose body is an add/delete table of typed columns. */
export function DynamicTableSection(props: {
  section: DynamicTableSectionDef;
}): ReactNode {
  return props.section.row_group ? (
    <GroupedTableSection section={props.section} />
  ) : (
    <FlatTableSection section={props.section} />
  );
}

function FlatTableSection(props: {
  section: DynamicTableSectionDef;
}): ReactNode {
  const { section } = props;
  const { values, onChange } = useForm();
  const rows = values.tables[section.id] ?? [];
  const min = section.min_rows ?? 0;
  const atMin = rows.length <= min;
  const totals = computeFlatTotals(section, rows);
  // Columns can be the engineer's, not the template's, when the section allows
  // added columns (SPEC §12) — a duct's traverse decides how many test points.
  const columns = columnsFor(values, section);
  const addColumns = section.add_columns;
  const atMinColumns = columns.length <= (addColumns?.min_count ?? 1);
  // The totals label spans every column before the first one that carries a
  // totals cell (the CHW FCU form's "Total Air Flow" spans the size columns).
  const firstTotalIndex = section.totals
    ? columns.findIndex((c) =>
        section.totals!.cells.some((cell) => cell.column === c.id),
      )
    : -1;
  const totalsLabelSpan =
    (section.auto_number ? 1 : 0) + Math.max(firstTotalIndex, 0);

  return (
    <section className="section" style={sectionStyle(section.font_size)}>
      <h2 className="section-title">
        {section.no ? `${section.no}. ` : ""}
        {section.title}
      </h2>
      {section._status && (
        <p className="section-note" role="note">
          {section._status}
        </p>
      )}

      <div className="table-scroll">
        <table className="dynamic-table">
          <thead>
            <tr>
              {section.auto_number && <th className="col-num">#</th>}
              {columns.map((col) => (
                <th key={col.id} style={{ width: col.width }}>
                  {col.label}
                  {col.unit ? ` (${col.unit})` : ""}
                  {addColumns && (
                    <button
                      type="button"
                      className="col-remove"
                      onClick={() =>
                        onChange(removeTableColumn(values, section, col.id))
                      }
                      disabled={atMinColumns}
                      aria-label={`Remove ${col.label}`}
                      title={`Remove ${col.label}`}
                    >
                      ✕
                    </button>
                  )}
                </th>
              ))}
              <th className="col-actions">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {section.auto_number && (
                  <td className="col-num">{index + 1}</td>
                )}
                {columns.map((col) =>
                  col.type === "calculated" ? (
                    <td key={col.id} className="col-computed">
                      <output
                        className="field-calculated"
                        aria-label={`${col.label} row ${index + 1}`}
                      >
                        {computeCell(col, row) || "—"}
                      </output>
                    </td>
                  ) : (
                    <td key={col.id}>
                      <FieldControl
                        type={col.type}
                        value={row[col.id] ?? ""}
                        onChange={(v) =>
                          onChange(setTableCell(values, section.id, index, col.id, v))
                        }
                        id={`${section.id}-${index}-${col.id}`}
                        ariaLabel={`${col.label} row ${index + 1}`}
                        limit={col.limit}
                        states={col.states}
                        align={col.align}
                      />
                    </td>
                  ),
                )}
                <td className="col-actions">
                  <button
                    type="button"
                    className="row-remove"
                    onClick={() =>
                      onChange(removeTableRow(values, section, index))
                    }
                    disabled={atMin}
                    aria-label={`Remove row ${index + 1}`}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          {section.totals && (
            <tfoot>
              <tr className="grouped-table-totals">
                <td className="totals-label" colSpan={totalsLabelSpan}>
                  {section.totals.label}
                </td>
                {columns
                  .slice(Math.max(firstTotalIndex, 0))
                  .map((col) => (
                    <td key={col.id} className="col-computed">
                      {totals[col.id] ?? ""}
                    </td>
                  ))}
                <td className="col-actions" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="table-tools">
        <button
          type="button"
          className="row-add"
          onClick={() => onChange(addTableRow(values, section))}
        >
          + Add row
        </button>
        {addColumns && (
          <button
            type="button"
            className="row-add"
            onClick={() => onChange(addTableColumn(values, section))}
          >
            + Add {addColumns.label_prefix.toLowerCase()}
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * A table whose rows are grouped under shared spanning cells, each group closed
 * by a totals line (SPEC §12) — the shape of the VAV air balancing report, where
 * one VAV unit serves several diffusers.
 */
function GroupedTableSection(props: {
  section: DynamicTableSectionDef;
}): ReactNode {
  const { section } = props;
  const group = section.row_group;
  const { values, onChange } = useForm();
  const groups = groupsFor(values, section.id);
  const seed = seedColumns(section);
  if (!group) return null;

  const minGroups = group.min_groups ?? 1;
  const bodyColumns = section.columns;
  // The totals label spans the group columns; the auto-number column, when
  // present, sits outside the group block and is spanned too.
  const labelSpan = (group.auto_number ? 1 : 0) + group.columns.length;

  return (
    <section className="section" style={sectionStyle(section.font_size)}>
      <h2 className="section-title">
        {section.no ? `${section.no}. ` : ""}
        {section.title}
      </h2>
      {section._status && (
        <p className="section-note" role="note">
          {section._status}
        </p>
      )}

      <div className="table-scroll">
        <table className="dynamic-table grouped-table">
          <thead>
            <tr>
              {group.auto_number && <th className="col-num">#</th>}
              {group.columns.map((col) => (
                <th key={col.id} style={{ width: col.width }}>
                  {col.label}
                  {col.unit ? ` (${col.unit})` : ""}
                </th>
              ))}
              {bodyColumns.map((col) => (
                <th key={col.id} style={{ width: col.width }}>
                  {col.label}
                  {col.unit ? ` (${col.unit})` : ""}
                </th>
              ))}
              <th className="col-actions">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          {groups.map((g, gi) => {
            const totals = computeTotals(section, g);
            const span = g.rows.length;
            return (
              <tbody key={gi} className="grouped-table-group">
                {g.rows.map((row, ri) => (
                  <tr key={ri}>
                    {ri === 0 && group.auto_number && (
                      <td className="col-num col-group" rowSpan={span}>
                        {gi + 1}
                      </td>
                    )}
                    {ri === 0 &&
                      group.columns.map((col) => (
                        <td key={col.id} className="col-group" rowSpan={span}>
                          <FieldControl
                            type={col.type}
                            value={g.fields[col.id] ?? ""}
                            onChange={(v) =>
                              onChange(
                                setGroupField(values, section.id, gi, col.id, v),
                              )
                            }
                            id={`${section.id}-g${gi}-${col.id}`}
                            ariaLabel={`${col.label} ${group.label} ${gi + 1}`}
                            limit={col.limit}
                            states={col.states}
                            align={col.align}
                          />
                        </td>
                      ))}
                    {bodyColumns.map((col) =>
                      col.type === "calculated" ? (
                        <td key={col.id} className="col-computed">
                          <output
                            className="field-calculated"
                            aria-label={`${col.label} ${group.label} ${gi + 1} row ${ri + 1}`}
                          >
                            {computeCell(col, row) || "—"}
                          </output>
                        </td>
                      ) : (
                        <td key={col.id}>
                          <FieldControl
                            type={col.type}
                            value={row[col.id] ?? ""}
                            onChange={(v) =>
                              onChange(
                                setGroupCell(values, section.id, gi, ri, col.id, v),
                              )
                            }
                            id={`${section.id}-g${gi}-r${ri}-${col.id}`}
                            ariaLabel={`${col.label} ${group.label} ${gi + 1} row ${ri + 1}`}
                            limit={col.limit}
                            states={col.states}
                            align={col.align}
                          />
                        </td>
                      ),
                    )}
                    <td className="col-actions">
                      <button
                        type="button"
                        className="row-remove"
                        onClick={() =>
                          onChange(removeGroupRow(values, section, gi, ri))
                        }
                        disabled={g.rows.length <= 1}
                        aria-label={`Remove row ${ri + 1} from ${group.label} ${gi + 1}`}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
                {group.totals && (
                  <tr className="grouped-table-totals">
                    <td className="totals-label" colSpan={labelSpan}>
                      {group.totals.label}
                    </td>
                    {bodyColumns.map((col) => (
                      <td key={col.id} className="col-computed">
                        {totals[col.id] ?? ""}
                      </td>
                    ))}
                    <td className="col-actions" />
                  </tr>
                )}
                <tr className="grouped-table-tools">
                  <td colSpan={labelSpan + bodyColumns.length + 1}>
                    <button
                      type="button"
                      className="row-add"
                      onClick={() =>
                        onChange(addGroupRow(values, section, gi, seed))
                      }
                    >
                      + Add row
                    </button>
                    <button
                      type="button"
                      className="row-remove-group"
                      onClick={() => onChange(removeGroup(values, section, gi))}
                      disabled={groups.length <= minGroups}
                    >
                      Remove {group.label} {gi + 1}
                    </button>
                  </td>
                </tr>
              </tbody>
            );
          })}
        </table>
      </div>

      <button
        type="button"
        className="row-add"
        onClick={() => onChange(addGroup(values, section))}
      >
        + Add {group.label}
      </button>
    </section>
  );
}

function sectionStyle(fontSize?: string): React.CSSProperties | undefined {
  return fontSize ? { fontSize } : undefined;
}
