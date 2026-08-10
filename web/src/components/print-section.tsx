import { Fragment, type ReactNode } from "react";
import {
  isDynamicTableSection,
  isFieldGroupSection,
  isMatrixSection,
  isSignOffSection,
  isStandardSection,
  type DynamicTableSection,
  type FieldGroupSection,
  type MatrixSection,
  type Row,
  type Section,
  type SignOffSection,
  type StandardSection,
} from "@schema";
import type { AttachmentView } from "../data/attachment";
import type { SignatureView } from "../data/signature";
import { computeCell, computeFlatTotals, computeTotals } from "../lib/grouped-table";
import type { VarMap } from "../lib/interpolate";
import { formatFieldValue } from "../lib/print-format";
import { groupsFor, type RecordValues } from "../lib/values";
import { PrintDescription } from "./print-description";
import { PrintSignatureGrid } from "./print-sign-off";

/**
 * One section as printed: a title, an optional interstitial (the header info
 * block on the first page), then a body matching the source form's layout.
 * Shape is driven by the template — every section type renders here, nothing
 * form-specific is hardcoded.
 */
const NO_ATTACHMENTS: Map<string, AttachmentView[]> = new Map();

export function PrintSection(props: {
  section: Section;
  values: RecordValues;
  vars: VarMap;
  signatures?: Map<string, SignatureView>;
  attachments?: Map<string, AttachmentView[]>;
  interstitial?: ReactNode;
}): ReactNode {
  const { section, values, vars, signatures, attachments, interstitial } = props;
  return (
    <>
      <h1 className="print-section-title">
        {section.no ?? ""}
        <span />
        {section.title ?? "Sign-off"}
      </h1>
      {"_status" in section && section._status ? (
        <p className="print-note">{section._status}</p>
      ) : null}
      {interstitial}
      {renderBody(section, values, vars, signatures, attachments ?? NO_ATTACHMENTS)}
    </>
  );
}

function renderBody(
  section: Section,
  values: RecordValues,
  vars: VarMap,
  signatures: Map<string, SignatureView> | undefined,
  attachments: Map<string, AttachmentView[]>,
): ReactNode {
  if (isDynamicTableSection(section))
    return <DynamicTable section={section} values={values} />;
  if (isMatrixSection(section))
    return <MatrixTable section={section} values={values} />;
  if (isFieldGroupSection(section))
    return <FieldGroupBlock section={section} values={values} />;
  if (isSignOffSection(section))
    return <SignOffBlock section={section} captured={signatures} />;
  if (isStandardSection(section))
    return <StandardTable section={section} values={values} vars={vars} attachments={attachments} />;
  return null;
}

/** Captured photos for a row: a `photo` row keys on its id, a `photo:true` add-on on `${id}:photo`. */
function photosForRow(row: Row, attachments: Map<string, AttachmentView[]>): AttachmentView[] {
  const key = row.type === "photo" ? row.id : row.photo ? `${row.id}:photo` : null;
  return key ? attachments.get(key) ?? [] : [];
}

function DynamicTable(props: {
  section: DynamicTableSection;
  values: RecordValues;
}): ReactNode {
  const { section, values } = props;
  if (section.row_group) return <GroupedTable section={section} values={values} />;
  const rows = values.tables[section.id] ?? [];
  const totals = computeFlatTotals(section, rows);
  // The totals label spans every column before the first one carrying a totals
  // cell, matching the source form's "Total Air Flow" row (SPEC §12).
  const firstTotalIndex = section.totals
    ? section.columns.findIndex((c) =>
        section.totals!.cells.some((cell) => cell.column === c.id),
      )
    : -1;
  const totalsLabelSpan =
    (section.auto_number ? 1 : 0) + Math.max(firstTotalIndex, 0);
  return (
    <table className="print-table">
      <thead>
        <tr>
          {section.auto_number && (
            <th className="print-num-col">{section.number_label ?? "S / No"}</th>
          )}
          {section.columns.map((col) => (
            <th key={col.id} style={{ width: col.width }}>
              {col.label}
              {col.unit ? ` (${col.unit})` : ""}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {section.auto_number && <td className="print-c">{i + 1}</td>}
            {section.columns.map((col) => (
              <td
                key={col.id}
                className={col.type === "calculated" ? "print-computed" : undefined}
                style={col.align ? { textAlign: col.align } : undefined}
              >
                {col.type === "calculated"
                  ? computeCell(col, row)
                  : formatFieldValue(col.type, row[col.id] ?? "", {
                      states: col.states,
                    })}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {section.totals && (
        <tfoot>
          <tr className="print-totals-row">
            <td className="print-totals-label" colSpan={totalsLabelSpan}>
              {section.totals.label}
            </td>
            {section.columns.slice(Math.max(firstTotalIndex, 0)).map((col) => (
              <td key={col.id} className="print-c">
                {totals[col.id] ?? ""}
              </td>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  );
}

/**
 * A grouped table as printed: each group's fields occupy cells spanning its body
 * rows, closed by a totals line (SPEC §12). Computed cells come from the same
 * `lib/grouped-table` helpers the form uses, so what the engineer saw while
 * filling is what the signed document carries.
 */
function GroupedTable(props: {
  section: DynamicTableSection;
  values: RecordValues;
}): ReactNode {
  const { section, values } = props;
  const group = section.row_group;
  if (!group) return null;
  const groups = groupsFor(values, section.id);
  const labelSpan = (group.auto_number ? 1 : 0) + group.columns.length;

  return (
    <table className="print-table print-grouped">
      <thead>
        <tr>
          {group.auto_number && (
            <th className="print-num-col">{section.number_label ?? "S / No"}</th>
          )}
          {group.columns.map((col) => (
            <th key={col.id} style={{ width: col.width }}>
              {col.label}
              {col.unit ? ` (${col.unit})` : ""}
            </th>
          ))}
          {section.columns.map((col) => (
            <th key={col.id} style={{ width: col.width }}>
              {col.label}
              {col.unit ? ` (${col.unit})` : ""}
            </th>
          ))}
        </tr>
      </thead>
      {groups.map((g, gi) => {
        const totals = computeTotals(section, g);
        const span = g.rows.length;
        return (
          <tbody key={gi} className="print-group">
            {g.rows.map((row, ri) => (
              <tr key={ri}>
                {ri === 0 && group.auto_number && (
                  <td className="print-c print-group-cell" rowSpan={span}>
                    {gi + 1}
                  </td>
                )}
                {ri === 0 &&
                  group.columns.map((col) => (
                    <td
                      key={col.id}
                      className="print-c print-group-cell"
                      rowSpan={span}
                    >
                      {formatFieldValue(col.type, g.fields[col.id] ?? "", {
                        states: col.states,
                        unit: col.unit,
                      })}
                    </td>
                  ))}
                {section.columns.map((col) => (
                  <td
                    key={col.id}
                    className={col.type === "calculated" ? "print-c print-computed" : "print-c"}
                    style={col.align ? { textAlign: col.align } : undefined}
                  >
                    {col.type === "calculated"
                      ? computeCell(col, row)
                      : formatFieldValue(col.type, row[col.id] ?? "", {
                          states: col.states,
                          unit: col.unit,
                        })}
                  </td>
                ))}
              </tr>
            ))}
            {group.totals && (
              <tr className="print-totals-row">
                <td className="print-totals-label" colSpan={labelSpan}>
                  {group.totals.label}
                </td>
                {section.columns.map((col) => (
                  <td key={col.id} className="print-c">
                    {totals[col.id] ?? ""}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        );
      })}
    </table>
  );
}

/** A fixed numeric grid: each band prints a point-label row then a values row. */
function MatrixTable(props: {
  section: MatrixSection;
  values: RecordValues;
}): ReactNode {
  const { section, values } = props;
  return (
    <table className="print-table print-matrix">
      <tbody>
        {section.row_bands.map((band) => (
          <Fragment key={band.id ?? band.label}>
            <tr className="print-matrix-head">
              <th scope="row">
                {band.label}
                {band.unit ? ` (${band.unit})` : ""}
              </th>
              {band.points.map((point) => (
                <td key={point.id} className="print-c print-matrix-pt">
                  {point.label}
                </td>
              ))}
            </tr>
            <tr>
              <td className="print-c print-matrix-unit">{band.unit ?? ""}</td>
              {band.points.map((point) => (
                <td key={point.id} className="print-c">
                  {values.rows[point.id]?.value ?? ""}
                </td>
              ))}
            </tr>
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

/** A group of header-style fields printed as a labelled value grid. */
function FieldGroupBlock(props: {
  section: FieldGroupSection;
  values: RecordValues;
}): ReactNode {
  const { section, values } = props;
  return (
    <div className="print-info-block">
      <div className="print-info-grid">
        {section.fields.map((field) => (
          <Fragment key={field.id}>
            <div className="print-lbl">{field.label}</div>
            <div className="print-colon">:</div>
            <div className={field.bold ? "print-val print-bold" : "print-val"}>
              {formatFieldValue(field.type, values.header[field.id] ?? "", {
                unit: field.unit,
              })}
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function SignOffBlock(props: {
  section: SignOffSection;
  captured?: Map<string, SignatureView>;
}): ReactNode {
  return (
    <PrintSignatureGrid
      signatures={props.section.signatures}
      captured={props.captured}
    />
  );
}

function StandardTable(props: {
  section: StandardSection;
  values: RecordValues;
  vars: VarMap;
  attachments: Map<string, AttachmentView[]>;
}): ReactNode {
  const { section, values, vars, attachments } = props;
  const cols = section.columns;
  const added = values.added[section.id] ?? [];
  let lastGroup: string | undefined;

  return (
    <table className="print-table">
      <thead>
        <tr>
          <th className="print-num-col" />
          <th>Description</th>
          <th style={{ width: cols?.result?.width }}>
            {cols?.result?.label ?? "Result"}
          </th>
          <th style={{ width: cols?.remarks?.width }}>
            {cols?.remarks?.label ?? "Remarks"}
          </th>
        </tr>
      </thead>
      <tbody>
        {section.rows.map((row) => {
          const rowValue = values.rows[row.id] ?? { value: "", remarks: "" };
          const groupRow =
            row.group && row.group !== lastGroup ? (
              <tr key={`group-${row.id}`} className="print-group-row">
                <td colSpan={4}>{row.group}</td>
              </tr>
            ) : null;
          lastGroup = row.group ?? lastGroup;
          const photos = photosForRow(row, attachments);
          return (
            <Fragment key={row.id}>
              {groupRow}
              <tr>
                <td className="print-c">{row.no ?? ""}</td>
                <td className="print-desc">
                  <PrintDescription
                    text={row.description}
                    vars={vars}
                    emphasis={row.emphasis}
                  />
                </td>
                <td className="print-c">
                  {formatFieldValue(row.type, rowValue.value, {
                    labels: row.labels,
                    states: row.states,
                    unit: row.unit,
                  })}
                </td>
                <td className="print-remarks">{rowValue.remarks}</td>
              </tr>
              {photos.length > 0 && (
                <tr className="print-photo-row">
                  <td className="print-c" />
                  <td colSpan={3}>
                    <div className="print-photos">
                      {photos.map((photo) => (
                        <figure key={photo.id} className="print-photo">
                          <img src={photo.image_url} alt={photo.caption || row.description} />
                          {photo.caption && <figcaption>{photo.caption}</figcaption>}
                        </figure>
                      ))}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
        {added.map((row) => (
          <tr key={row.id}>
            <td className="print-c">{row.no}</td>
            <td className="print-desc">{row.description}</td>
            <td className="print-c">
              {formatFieldValue(section.add_row_template?.type ?? "text", row.value, {
                states: section.add_row_template?.states,
              })}
            </td>
            <td className="print-remarks">{row.remarks}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
