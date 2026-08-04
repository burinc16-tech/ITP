import type { ReactNode } from "react";
import type { Row, StandardSection } from "@schema";
import { setRowRemarks, setRowValue } from "../lib/values";
import { Description } from "./description";
import { FieldControl } from "./field-control";
import { useForm } from "./form-context";
import { PhotoField } from "./photo-field";

/** One checklist step: number, description, result control, and remarks. */
export function FormRow(props: {
  row: Row;
  columns: StandardSection["columns"];
}): ReactNode {
  const { row, columns } = props;
  const { values, onChange } = useForm();
  const rowValue = values.rows[row.id] ?? { value: "", remarks: "" };

  const remarksEnabled = row.remarks !== undefined && row.remarks !== false;
  const remarksMultiline = row.remarks === "textarea";
  const resultLabel = columns?.result?.label ?? "Result";
  const remarksLabel = columns?.remarks?.label ?? "Remarks";

  // "N/A requires a remark" (SPEC §5) — for a three-state pass_fail_na, or for a
  // status field whose selected state has an `na` outcome (only when the row
  // actually carries a remarks cell to fill).
  const selectedState =
    row.type === "status"
      ? row.states?.find((s) => s.value === rowValue.value)
      : undefined;
  const isNa =
    (row.type === "pass_fail_na" && rowValue.value === "na") ||
    (row.type === "status" && selectedState?.outcome === "na");
  const naNeedsRemark =
    isNa &&
    rowValue.remarks.trim() === "" &&
    (row.type === "pass_fail_na" || remarksEnabled);

  return (
    <div className="form-row">
      <div className="form-row-desc">
        {row.no && <span className="form-row-no">{row.no}</span>}
        <span>
          <Description text={row.description} emphasis={row.emphasis} />
        </span>
      </div>

      <div className="form-row-result">
        <span className="form-row-label">{resultLabel}</span>
        {row.type === "photo" ? (
          <PhotoField fieldId={row.id} label={`Photos — ${row.no ?? row.id}`} />
        ) : (
          <FieldControl
            type={row.type}
            value={rowValue.value}
            onChange={(v) => onChange(setRowValue(values, row.id, v))}
            id={`row-${row.id}`}
            ariaLabel={`${resultLabel} — ${row.no ?? row.id}`}
            unit={row.unit}
            options={row.options}
            limit={row.limit}
            labels={row.labels}
            states={row.states}
          />
        )}
      </div>

      {row.photo && row.type !== "photo" && (
        <div className="form-row-photo">
          <span className="form-row-label">Photos</span>
          <PhotoField fieldId={`${row.id}:photo`} label={`Photos — ${row.no ?? row.id}`} />
        </div>
      )}

      {remarksEnabled && (
        <div className="form-row-remarks">
          <span className="form-row-label">{remarksLabel}</span>
          <FieldControl
            type={remarksMultiline ? "textarea" : "text"}
            value={rowValue.remarks}
            onChange={(v) => onChange(setRowRemarks(values, row.id, v))}
            id={`row-${row.id}-remarks`}
            ariaLabel={`${remarksLabel} — ${row.no ?? row.id}`}
          />
        </div>
      )}

      {naNeedsRemark && (
        <p className="field-error" role="alert">
          {remarksLabel} is required when this is marked N/A — say why it does not
          apply.
        </p>
      )}
    </div>
  );
}
