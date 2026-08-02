import type { ReactNode } from "react";
import type { DynamicTableSection as DynamicTableSectionDef } from "@schema";
import { addTableRow, removeTableRow, setTableCell } from "../lib/values";
import { FieldControl } from "./field-control";
import { useForm } from "./form-context";

/** A section whose body is an add/delete table of typed columns. */
export function DynamicTableSection(props: {
  section: DynamicTableSectionDef;
}): ReactNode {
  const { section } = props;
  const { values, onChange } = useForm();
  const rows = values.tables[section.id] ?? [];
  const min = section.min_rows ?? 0;
  const atMin = rows.length <= min;

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
              {section.columns.map((col) => (
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
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {section.auto_number && (
                  <td className="col-num">{index + 1}</td>
                )}
                {section.columns.map((col) => (
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
                      align={col.align}
                    />
                  </td>
                ))}
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
        </table>
      </div>

      <button
        type="button"
        className="row-add"
        onClick={() => onChange(addTableRow(values, section))}
      >
        + Add row
      </button>
    </section>
  );
}

function sectionStyle(fontSize?: string): React.CSSProperties | undefined {
  return fontSize ? { fontSize } : undefined;
}
