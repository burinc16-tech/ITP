import type { ReactNode } from "react";
import { setHeader } from "../lib/values";
import { FieldControl } from "./field-control";
import { useForm } from "./form-context";

/** The record header fields (project, date, equipment tag, …). */
export function FormHeader(): ReactNode {
  const { template, values, onChange } = useForm();
  const header = template.header;

  return (
    <section className="section panel-header">
      <h2 className="section-title">{header.title ?? "Details"}</h2>
      <div className="field-grid">
        {header.fields.map((field) => (
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
              id={`hdr-${field.id}`}
              ariaLabel={field.label}
              readonly={field.readonly}
            />
          </label>
        ))}
      </div>
    </section>
  );
}
