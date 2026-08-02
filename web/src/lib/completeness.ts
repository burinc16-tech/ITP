import { isFieldGroupSection, type Template } from "@schema";
import type { RecordValues } from "./values";

export interface MissingField {
  id: string;
  label: string;
}

/**
 * Required fields still empty (SPEC §6 — a record can only be completed when all
 * required fields are filled). Only header and field_group fields carry a
 * `required` flag in the schema; checklist rows do not, so this is exhaustive.
 */
export function missingRequiredFields(
  template: Template,
  values: RecordValues,
): MissingField[] {
  const missing: MissingField[] = [];
  const check = (id: string, label: string) => {
    const v = values.header[id];
    if (v === undefined || v.trim() === "") missing.push({ id, label });
  };
  for (const f of template.header.fields) {
    if (f.required) check(f.id, f.label);
  }
  for (const section of template.sections) {
    if (isFieldGroupSection(section)) {
      for (const f of section.fields) if (f.required) check(f.id, f.label);
    }
  }
  return missing;
}

export function fieldsComplete(template: Template, values: RecordValues): boolean {
  return missingRequiredFields(template, values).length === 0;
}
