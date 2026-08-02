import type { ReactNode } from "react";
import { setVariable } from "../lib/values";
import { FieldControl } from "./field-control";
import { useForm } from "./form-context";

/**
 * The project-specific values (SPEC §5.1), set once and interpolated into every
 * `{{variable}}` in the checklist. Editing one updates all step text live.
 */
export function VariablesPanel(): ReactNode {
  const { template, values, onChange } = useForm();
  const variables = template.variables ?? [];
  if (variables.length === 0) return null;

  return (
    <section className="section panel-variables">
      <h2 className="section-title">Test parameters</h2>
      <p className="section-hint">
        Set once for this record — used throughout the checklist.
      </p>
      <div className="field-grid">
        {variables.map((variable) => (
          <label key={variable.id} className="field">
            <span className="field-label">
              {variable.label}
              {variable.unit ? ` (${variable.unit})` : ""}
            </span>
            <FieldControl
              type={variable.type === "number" ? "number" : "text"}
              value={values.variables[variable.id] ?? ""}
              onChange={(v) => onChange(setVariable(values, variable.id, v))}
              id={`var-${variable.id}`}
              ariaLabel={variable.label}
            />
          </label>
        ))}
      </div>
    </section>
  );
}
