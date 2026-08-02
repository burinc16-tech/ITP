import type { ReactNode } from "react";
import type { FieldGroupSection as FieldGroupSectionDef } from "@schema";
import { setHeader } from "../lib/values";
import { FieldControl } from "./field-control";
import { useForm } from "./form-context";

/**
 * A group of header-style fields in the section flow (SPEC §12) — e.g. the IDF
 * general-information block, or a per-page transmittal header on the Power
 * Turn-on form. Values share the flat `values.header` map keyed by field id.
 */
export function FieldGroupSection(props: {
  section: FieldGroupSectionDef;
}): ReactNode {
  const { section } = props;
  const { values, onChange } = useForm();

  return (
    <section className="section panel-header">
      <h2 className="section-title">
        {section.no ? `${section.no}. ` : ""}
        {section.title}
      </h2>
      <div className="field-grid">
        {section.fields.map((field) => (
          <label
            key={field.id}
            className={`field${field.bold ? " field-bold" : ""}`}
          >
            <span className="field-label">
              {field.label}
              {field.required ? " *" : ""}
            </span>
            <FieldControl
              type={field.type}
              value={values.header[field.id] ?? ""}
              onChange={(v) => onChange(setHeader(values, field.id, v))}
              id={`fg-${field.id}`}
              ariaLabel={field.label}
              readonly={field.readonly}
              options={field.options}
            />
          </label>
        ))}
      </div>
    </section>
  );
}
