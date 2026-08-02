import { describe, it, expect } from "vitest";
import { parseTemplate } from "@schema";
import rawTemplate from "../../../spec/templates/heat-load-test.json";
import { emptyValues } from "./values";
import { fieldsComplete, missingRequiredFields } from "./completeness";

const template = parseTemplate(rawTemplate);

describe("missingRequiredFields", () => {
  it("lists required header fields that are empty", () => {
    const missing = missingRequiredFields(template, emptyValues(template));
    const ids = missing.map((m) => m.id);
    expect(ids).toContain("doc_no");
    expect(ids).toContain("inspector");
    expect(ids).toContain("insp_date");
    expect(fieldsComplete(template, emptyValues(template))).toBe(false);
  });

  it("is satisfied once every required field is filled", () => {
    const values = emptyValues(template);
    values.header.doc_no = "ITR-001";
    values.header.inspector = "A. Engineer";
    values.header.insp_date = "2026-08-02";
    expect(missingRequiredFields(template, values)).toHaveLength(0);
    expect(fieldsComplete(template, values)).toBe(true);
  });
});
