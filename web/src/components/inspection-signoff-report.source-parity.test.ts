import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  isDynamicTableSection,
  isFieldGroupSection,
  isSignOffSection,
  isStandardSection,
  parseTemplate,
} from "@schema";
import rawTemplate from "../../../spec/templates/inspection-signoff-report.json";
import { satisfiedStages } from "../data/workflow";

/**
 * Parity between the converted template and the file it came from.
 *
 * This one is unlike every other parity test in the library, and the difference
 * is the point: the source has NO paper original — it is a self-authored,
 * scrolling web page with no A4 geometry — so there is nothing to compare a
 * printed page against. What is pinned here is CONTENT: the eight sections, the
 * fields in each, and the option lists, all checked against the source HTML.
 * Layout is this library's own and is deliberately not asserted against the
 * source.
 */

const SOURCE = resolve(process.cwd(), "spec/Inspection_Signoff_Report.html");
const template = parseTemplate(rawTemplate);
const html = readFileSync(SOURCE, "utf8");

/** Every field id the template declares, header and sections alike. */
const fieldIds = new Set<string>([
  ...template.header.fields.map((f) => f.id),
  ...template.sections.flatMap((s) => (isFieldGroupSection(s) ? s.fields.map((f) => f.id) : [])),
]);

describe("Inspection & Sign-Off Report — parity with the source file", () => {
  it("is a portrait, multi-discipline record with no paper original", () => {
    expect(template.code).toBe("ISR");
    expect(template.title).toBe("Inspection & Sign-Off Report");
    expect(template.category).toBe("ITR");
    expect(template.scope).toBe("location");
    expect(template.page).toEqual({ size: "A4", orientation: "portrait" });
    expect(html).toContain("INSPECTION &amp; SIGN-OFF REPORT");

    // The form is generic — nothing in it names a trade — so it is not filed
    // under one the way a test sheet is.
    expect(template.discipline).toBe("Multi-discipline");
    // The absence of a paper original is the fact most likely to be forgotten.
    expect(template.source).toContain("NO paper original");
  });

  it("carries the source's eight sections, numbered as the source numbers them", () => {
    // Section 1 is the record header, so the flow starts at 2.
    expect(template.header.title).toBe("Report Information");
    expect(template.sections.map((s) => s.no)).toEqual(["2", "3", "4", "5", "6", "7", "8"]);
    expect(template.sections.map((s) => s.title)).toEqual([
      "Inspector Details",
      "Scope & References",
      "Inspection Checklist",
      "Defects & Non-Conformances",
      "Overall Inspection Result",
      "Supporting Documents & Attachments",
      "Sign-Off",
    ]);
    for (const heading of [
      "1. Report Information",
      "2. Inspector Details",
      "3. Scope &amp; References",
      "4. Inspection Checklist",
      "5. Defects &amp; Non-Conformances",
      "6. Overall Inspection Result",
      "7. Supporting Documents &amp; Attachments",
      "8. Sign-Off",
    ]) {
      expect(html).toContain(heading);
    }
  });

  it("carries every input the source declares — except Report Status, on purpose", () => {
    // The source's own field list, verbatim from its SIMPLE_FIELDS array, minus
    // the signature name/date boxes (a `signature` slot captures those itself).
    const sourceFields = [
      "report_no", "insp_date", "project_name", "location", "department",
      "insp_name", "insp_title", "insp_id", "insp_company", "insp_contact", "insp_type",
      "scope", "standards", "defects", "corrective_action", "overall_comments", "attachments",
    ];
    for (const id of sourceFields) {
      expect(html).toContain(`id="${id}"`);
    }
    for (const id of sourceFields) {
      // `overall_comments` is the overall status row's remarks cell, not a field.
      if (id === "overall_comments") continue;
      expect(fieldIds.has(id)).toBe(true);
    }

    // THE ONE DELIBERATE OMISSION. The source has a hand-set Report Status whose
    // options are the app's own record statuses; carrying it would put two
    // statuses on one signed page, free to disagree. The note has to say so.
    expect(html).toContain('id="report_status"');
    expect(fieldIds.has("report_status")).toBe(false);
    const inspector = template.sections[0]!;
    expect(inspector._note).toContain("Report Status");
    expect(inspector._note).toContain("SPEC §6");

    // The signature name/date boxes are the slots, not extra fields.
    for (const id of ["sig_insp_name", "sig_sup_name", "sig_client_name"]) {
      expect(html).toContain(`id="${id}"`);
      expect(fieldIds.has(id)).toBe(false);
    }
  });

  it("carries the Inspection Type options, in the source's order", () => {
    const inspector = template.sections[0]!;
    if (!isFieldGroupSection(inspector)) throw new Error("inspector is not a field group");
    const type = inspector.fields.find((f) => f.id === "insp_type")!;
    expect(type.type).toBe("dropdown");
    expect(type.options).toEqual([
      "Routine",
      "Pre-commissioning",
      "Final Acceptance",
      "Safety",
      "Quality Assurance",
      "Audit",
      "Other",
    ]);
    for (const option of type.options!) {
      expect(html).toContain(`<option>${option}</option>`);
    }
  });

  it("carries the checklist's four columns with the source's three-state result", () => {
    const checklist = template.sections.find((s) => s.id === "checklist")!;
    if (!isDynamicTableSection(checklist)) throw new Error("checklist is not a dynamic table");

    expect(checklist.columns.map((c) => c.label)).toEqual([
      "Inspection Item",
      "Criteria / Standard",
      "Result",
      "Findings / Remarks",
    ]);
    for (const heading of [
      "Inspection Item",
      "Criteria / Standard",
      "Result",
      "Findings / Remarks",
    ]) {
      expect(html).toContain(heading);
    }

    // Pass / Fail / N/A is the library's existing three-state control, so a Fail
    // is derivable as an outstanding item without bespoke `status` states.
    expect(checklist.columns.find((c) => c.id === "result")!.type).toBe("pass_fail_na");
    expect(html).toContain('value="N/A"');

    // The source's own first column is a count, which is what `auto_number` is.
    expect(checklist.auto_number).toBe(true);
    expect(checklist.number_label).toBe("#");

    // The source seeds eight blank rows; a printed sheet cannot afford them.
    expect(html).toContain("const DEFAULT_ROWS = 8");
    expect(checklist.min_rows).toBe(3);
  });

  it("keeps the source's asymmetry: N/A per item, but Pass/Fail overall", () => {
    const overall = template.sections.find((s) => s.id === "overall")!;
    if (!isStandardSection(overall)) throw new Error("overall is not a standard section");
    const row = overall.rows[0]!;

    expect(row.type).toBe("status");
    expect(row.states!.map((s) => s.label)).toEqual(["Pass", "Fail"]);
    // The source's overall block offers only two radios — no N/A.
    expect(html).toContain('id="ov_pass"');
    expect(html).toContain('id="ov_fail"');
    expect(html).not.toContain('id="ov_na"');

    // The source's separate comments box is this row's remarks cell.
    expect(row.remarks).toBe("textarea");
    expect(html).toContain('id="overall_comments"');
  });
});

describe("Inspection & Sign-Off Report — three pads, three gated steps", () => {
  it("carries the source's three signature blocks in its order", () => {
    const signOff = template.sections.find((s) => s.id === "sign_off")!;
    if (!isSignOffSection(signOff)) throw new Error("sign_off is not a sign-off section");

    expect(signOff.signatures.map((s) => s.role)).toEqual([
      "Inspector",
      "Supervisor / Reviewer",
      "Client / Witness",
    ]);
    for (const label of [
      "Inspector Signature",
      "Supervisor / Reviewer Signature",
      "Client / Witness Signature",
    ]) {
      expect(html).toContain(label);
    }
    // Both sign-off blocks are sections; a top-level footer would add a page.
    expect(template.footer).toBeUndefined();
  });

  it("maps each pad onto a step the workflow actually gates", () => {
    const signOff = template.sections.find((s) => s.id === "sign_off")!;
    if (!isSignOffSection(signOff)) throw new Error("sign_off is not a sign-off section");

    // `check` is deliberately unused: no workflow rule references that stage, so
    // a slot on it would print without gating anything.
    expect(signOff.signatures.map((s) => s.stage)).toEqual([
      "contractor",
      "witness",
      "client",
    ]);
    // Only the inspector's is required — a report may be issued before the
    // reviewer and the client have got to it (as `sanitary-pipe-flood-test`).
    expect(signOff.signatures.map((s) => s.required)).toEqual([true, false, false]);
  });

  it("gates draft → accepted on all three, one per step", () => {
    // Nothing signed: every gated stage is still shut.
    const none = satisfiedStages(template, new Set());
    for (const stage of ["contractor", "witness", "client"] as const) {
      expect(none.has(stage)).toBe(false);
    }
    // `check` has no slot, so it is satisfied vacuously and never blocks.
    expect(none.has("check")).toBe(true);

    expect(satisfiedStages(template, new Set(["sig_inspector"])).has("contractor")).toBe(true);
    expect(satisfiedStages(template, new Set(["sig_supervisor"])).has("witness")).toBe(true);
    expect(satisfiedStages(template, new Set(["sig_client"])).has("client")).toBe(true);
  });
});

describe("Inspection & Sign-Off Report — pagination", () => {
  it("splits into four pages on declared breaks, not one section per sheet", () => {
    const breaks = template.sections.map(
      (s) => (s as { page_break_before?: boolean }).page_break_before === true,
    );
    // Inspector + Scope | Checklist | Defects + Overall + Attachments | Sign-Off.
    // A break on the opening section is a no-op — it is already page 1 — and is
    // what stops `paginate` giving all seven sections a sheet of their own.
    expect(breaks).toEqual([true, false, true, true, false, false, true]);

    const pages = breaks.reduce<number>((n, b, i) => (i === 0 || b ? n + 1 : n), 0);
    expect(pages).toBe(4);
  });

  it("carries no record data or placeholder hints from the source", () => {
    const json = JSON.stringify(rawTemplate, (key, value) =>
      key === "_note" || key === "_status" || key === "source" ? undefined : value,
    );
    // Placeholders are input hints, not template wording — printed, they would
    // read as content.
    for (const placeholder of [
      "e.g. INS-2026-001",
      "e.g. ISO 9001, ASTM A123, Drawing Rev. C...",
      "e.g. Quality Engineer",
      "Photo_001.jpg",
    ]) {
      expect(html).toContain(placeholder);
      expect(json).not.toContain(placeholder);
    }
  });
});
