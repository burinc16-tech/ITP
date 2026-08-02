import { Fragment, type ReactNode } from "react";
import type {
  AddRowTemplate,
  StandardSection as StandardSectionDef,
} from "@schema";
import {
  addChecklistRow,
  removeChecklistRow,
  setAddedRowField,
  type AddedRow,
} from "../lib/values";
import { FieldControl } from "./field-control";
import { FormRow } from "./form-row";
import { useForm } from "./form-context";

/** A section whose body is a fixed list of checklist steps. */
export function StandardSection(props: {
  section: StandardSectionDef;
}): ReactNode {
  const { section } = props;
  const { values, onChange } = useForm();
  const added = values.added[section.id] ?? [];

  // Group header before the first row of each contiguous `group` run.
  let lastGroup: string | undefined;

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
      <div className="section-rows">
        {section.rows.map((row) => {
          const groupHeader =
            row.group && row.group !== lastGroup ? (
              <div
                className="section-group"
                role="heading"
                aria-level={3}
                key={`group-${row.id}`}
              >
                {row.group}
              </div>
            ) : null;
          lastGroup = row.group ?? lastGroup;
          return (
            <Fragment key={row.id}>
              {groupHeader}
              <FormRow row={row} columns={section.columns} />
            </Fragment>
          );
        })}

        {section.allow_add_rows &&
          added.map((row) => (
            <AddedFormRow
              key={row.id}
              sectionId={section.id}
              row={row}
              template={section.add_row_template}
            />
          ))}
      </div>

      {section.allow_add_rows && (
        <button
          type="button"
          className="row-add"
          onClick={() => onChange(addChecklistRow(values, section.id))}
        >
          + Add item
        </button>
      )}
    </section>
  );
}

/** An engineer-appended ad-hoc row: editable text plus the template's control. */
function AddedFormRow(props: {
  sectionId: string;
  row: AddedRow;
  template?: AddRowTemplate;
}): ReactNode {
  const { sectionId, row, template } = props;
  const { values, onChange } = useForm();
  const set = (
    field: "no" | "group" | "description" | "value" | "remarks",
    v: string,
  ) => onChange(setAddedRowField(values, sectionId, row.id, field, v));

  const remarksEnabled =
    template?.remarks !== undefined && template?.remarks !== false;
  const remarksMultiline = template?.remarks === "textarea";

  return (
    <div className="form-row form-row-added">
      <div className="form-row-desc">
        {template?.editable_no && (
          <input
            className="added-no"
            aria-label="Item no."
            value={row.no}
            onChange={(e) => set("no", e.target.value)}
          />
        )}
        {template?.editable_group && (
          <input
            className="added-group"
            aria-label="Item group"
            placeholder="Group"
            value={row.group}
            onChange={(e) => set("group", e.target.value)}
          />
        )}
        <input
          className="added-desc"
          aria-label="Added item description"
          placeholder="Describe the item"
          value={row.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </div>

      <div className="form-row-result">
        <span className="form-row-label">Result</span>
        <FieldControl
          type={template?.type ?? "text"}
          value={row.value}
          onChange={(v) => set("value", v)}
          id={`added-${row.id}`}
          ariaLabel="Result — added item"
          states={template?.states}
        />
      </div>

      {remarksEnabled && (
        <div className="form-row-remarks">
          <span className="form-row-label">Remarks</span>
          <FieldControl
            type={remarksMultiline ? "textarea" : "text"}
            value={row.remarks}
            onChange={(v) => set("remarks", v)}
            id={`added-${row.id}-remarks`}
            ariaLabel="Remarks — added item"
          />
        </div>
      )}

      <button
        type="button"
        className="row-remove"
        onClick={() => onChange(removeChecklistRow(values, sectionId, row.id))}
        aria-label="Remove added item"
      >
        ✕
      </button>
    </div>
  );
}

function sectionStyle(fontSize?: string): React.CSSProperties | undefined {
  return fontSize ? { fontSize } : undefined;
}
