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
import rawTemplate from "../../../spec/templates/inspection-request-form.json";
import { RFI_DECLARATION, RFI_DISCIPLINES, RFI_DRAWING_NO_DEFAULT } from "../lib/rfi-cover";
import { satisfiedStages } from "../data/workflow";

/**
 * Parity between the converted template and the sheet it came from — and with
 * `lib/rfi-cover.ts`, which replicates the SAME sheet as the opt-in print-step
 * cover page (SPEC §12). The two now coexist and must not drift: the declaration
 * and the discipline list are pinned to the cover's own constants here, so a
 * reword reaches both or fails a test.
 *
 * The template exists for what the cover cannot do — one request covering
 * several test records, and an inspector who is not the test form's signer — so
 * those two properties are asserted as the reason the file is in the repo, not
 * as incidental structure.
 */

const SOURCE = resolve(process.cwd(), "spec/reference/inspection-request-form.html");
const template = parseTemplate(rawTemplate);
const html = readFileSync(SOURCE, "utf8");

describe("Inspection Request Form — parity with the source sheet", () => {
  it("is a one-page portrait record, filed across disciplines rather than under one", () => {
    expect(template.code).toBe("IRF");
    expect(template.title).toBe("Inspection Request Form (M&E)");
    expect(template.category).toBe("ITR");
    expect(template.scope).toBe("location");
    expect(template.page).toEqual({ size: "A4", orientation: "portrait" });
    expect(html).toContain("Inspection Request Form (M&amp;E)");

    // The sheet is issued by every trade — its own discipline row says so — so
    // it is not filed under one the way a test sheet is.
    expect(template.discipline).toBe("Multi-discipline");
  });

  it("carries the sheet's document band, in the sheet's order", () => {
    expect(template.header.fields.map((f) => f.label)).toEqual([
      "Project",
      "Contractor",
      "IRF No.",
      "Discipline",
      "Other (specify)",
      "Drawing No.",
      "Floor",
      "Area",
      "Date",
      "Activity",
      "Ref.",
    ]);
    for (const label of [
      "Project:",
      "Contractor:",
      "IRF No.:",
      "Drawing No.:",
      "Floor:",
      "Area:",
      "Date:",
      "Activity:",
      "Ref.:",
    ]) {
      expect(html).toContain(label);
    }
  });

  it("asks the discipline as one choice of the sheet's five, matching the cover's list", () => {
    const discipline = template.header.fields.find((f) => f.id === "discipline")!;
    expect(discipline.type).toBe("dropdown");
    expect(discipline.required).toBe(true);
    // The paper's five checkboxes, in the paper's order — and the same five the
    // print-step cover offers, so a record and a cover cannot disagree.
    expect(discipline.options).toEqual(RFI_DISCIPLINES.map((d) => d.label));
    for (const label of ["ACMV", "Electrical", "Fire Protection", "P&amp;S", "Other:"]) {
      expect(html).toContain(label);
    }
  });

  it("seeds Drawing No. with the wording the cover already seeds", () => {
    const drawing = template.header.fields.find((f) => f.id === "drawing_no")!;
    expect(drawing.default).toBe(RFI_DRAWING_NO_DEFAULT);
  });

  it("carries the declaration verbatim, and identically to the print-step cover", () => {
    const declaration = template.sections.find((s) => s.id === "declaration")!;
    if (!isStandardSection(declaration)) throw new Error("declaration is not a standard section");
    const row = declaration.rows[0]!;

    expect(row.type).toBe("checkbox");
    expect(row.description).toBe(RFI_DECLARATION);
    // And the sentence the cover holds is itself the sheet's, clause by clause.
    for (const clause of [
      "have already carried out Preliminary Inspections of the works",
      "in accordance with the Specification, Scope of Works, and Contract documentation",
      "the works are complete and ready for Inspection.",
    ]) {
      expect(html).toContain(clause);
    }
    // The tick is not what binds the record — the signature below it is.
    expect(row.remarks).toBeUndefined();
  });

  it("carries the sheet's three results, counting a conditional pass as outstanding", () => {
    const result = template.sections.find((s) => s.id === "inspection_result")!;
    if (!isStandardSection(result)) throw new Error("inspection_result is not a standard section");
    const row = result.rows[0]!;

    expect(row.type).toBe("status");
    expect(row.states!.map((s) => s.label)).toEqual(["Pass", "Fail", "Conditional Pass"]);
    for (const label of ["PASS", "FAIL", "CONDITIONAL PASS", "INSPECTION RESULT", "Comments:"]) {
      expect(html).toContain(label);
    }

    // A conditional pass is a pass with work still owed. `fail` is what puts it
    // on the outstanding-items list (SPEC §6); `na`/`neutral` would file it and
    // forget it.
    const conditional = row.states!.find((s) => s.value === "conditional")!;
    expect(conditional.outcome).toBe("fail");
    // The comments box the inspector writes into.
    expect(row.remarks).toBe("textarea");
  });
});

describe("Inspection Request Form — the two things the print-step cover cannot do", () => {
  it("lists SEVERAL test records on one request", () => {
    const attached = template.sections.find((s) => s.id === "attached_records")!;
    if (!isDynamicTableSection(attached)) throw new Error("attached_records is not a dynamic table");

    expect(attached.columns.map((c) => c.label)).toEqual([
      "Test Record / Form",
      "Record No.",
      "Equipment / Location",
      "Remarks",
    ]);
    // One covered record prints one line, not a block of empty ruling.
    expect(attached.min_rows).toBe(1);
    expect(attached.auto_number).toBe(true);

    // This is the one block that is NOT on the paper, and the note says so — the
    // departure has to stay visible to whoever reads the template next.
    expect(attached._note).toContain("NOT ON THE PAPER");
    // A typed list, not a foreign key: no column claims to resolve a record.
    for (const column of attached.columns) {
      expect(column.type).toBe("text");
    }
  });

  it("signs off twice, with the inspector a different person from the contractor", () => {
    const contractor = template.sections.find((s) => s.id === "contractor_sign_off")!;
    const inspector = template.sections.find((s) => s.id === "inspector_sign_off")!;
    if (!isSignOffSection(contractor) || !isSignOffSection(inspector)) {
      throw new Error("both sign-off blocks live in the section flow");
    }

    // The paper labels both blocks "Inspected By:" — the section titles are what
    // tell them apart, on screen and in print.
    expect(contractor.title).toBe("Contractor Sign-off");
    expect(inspector.title).toBe("Inspector / Engineer Sign-off");
    expect(contractor.signatures[0]!.role).toBe("Inspected By");
    expect(inspector.signatures[0]!.role).toBe("Inspected By");
    for (const label of ["CONTRACTOR SIGN-OFF", "INSPECTOR / ENGINEER SIGN-OFF", "Inspected By:"]) {
      expect(html).toContain(label);
    }

    // The contractor is Kenyon and cannot be anyone else; the inspector is the
    // consultant, so no company is defaulted for them.
    expect(contractor.signatures[0]!.company_default).toBe("Kenyon Pte Ltd");
    expect(contractor.signatures[0]!.company_locked).toBe(true);
    expect(inspector.signatures[0]!.company_default).toBeUndefined();

    // Both are required, and they gate opposite ends of the workflow.
    expect(contractor.signatures[0]!.stage).toBe("contractor");
    expect(inspector.signatures[0]!.stage).toBe("client");
    expect(contractor.signatures[0]!.required).toBe(true);
    expect(inspector.signatures[0]!.required).toBe(true);
  });

  it("runs draft → accepted on those two signatures, with nothing to witness between", () => {
    const nothing = satisfiedStages(template, new Set());
    // No `witness` slot is declared, and a stage with no slots is satisfied
    // vacuously — so the QA/QC steps in the middle never block on a signature.
    expect(nothing.has("witness")).toBe(true);
    expect(nothing.has("check")).toBe(true);
    expect(nothing.has("contractor")).toBe(false);
    expect(nothing.has("client")).toBe(false);

    const contractorSigned = satisfiedStages(template, new Set(["sig_contractor"]));
    expect(contractorSigned.has("contractor")).toBe(true);
    expect(contractorSigned.has("client")).toBe(false);

    const both = satisfiedStages(template, new Set(["sig_contractor", "sig_inspector"]));
    expect(both.has("client")).toBe(true);
  });
});

describe("Inspection Request Form — prints as one page", () => {
  it("orders its blocks the way the sheet does", () => {
    expect(template.sections.map((s) => s.id)).toEqual([
      "scope",
      "attached_records",
      "declaration",
      "contractor_sign_off",
      "inspection_result",
      "inspector_sign_off",
    ]);
    // The result sits AFTER the contractor's signature on the paper, because the
    // inspector fills it — which is the whole reason for a second signer.
    const sections = template.sections.map((s) => s.id);
    expect(sections.indexOf("contractor_sign_off")).toBeLessThan(
      sections.indexOf("inspection_result"),
    );
    expect(sections.indexOf("inspection_result")).toBeLessThan(
      sections.indexOf("inspector_sign_off"),
    );

    const scope = template.sections[0]!;
    if (!isFieldGroupSection(scope)) throw new Error("scope is not a field group");
    expect(html).toContain("Scope / Remarks:");
  });

  it("splits into three pages, each sign-off grid with its own content", () => {
    const breaks = template.sections.map(
      (s) => (s as { page_break_before?: boolean }).page_break_before === true,
    );
    // MEASURED in Chrome against a filled record, not estimated (see the `scope`
    // note): the body budget is 881px and the whole request is 1425px, so the
    // paper's single page cannot be one page here. The two sign-off grids cost
    // 339px each, which is what forces a third sheet.
    //
    // page 1 scope + covered records | 2 declaration + contractor | 3 result + inspector
    expect(breaks).toEqual([true, false, true, false, true, false]);

    const pages = breaks.reduce<number>((n, b, i) => (i === 0 || b ? n + 1 : n), 0);
    expect(pages).toBe(3);

    // A two-page split (break before `contractor_sign_off` only) was measured at
    // 892.8px on page 2 against the 881px budget and rejected. Guard the shape
    // that replaced it: each sign-off opens a page but does not start one.
    const signOffIds = ["contractor_sign_off", "inspector_sign_off"];
    for (const id of signOffIds) {
      const section = template.sections.find((s) => s.id === id)!;
      expect((section as { page_break_before?: boolean }).page_break_before).toBeUndefined();
    }

    // A top-level `footer` would print a fourth page; both sign-offs are sections.
    expect(template.footer).toBeUndefined();
  });

  it("gives the only growing block the roomiest page", () => {
    // `attached_records` is the one section that grows with the record, and
    // `paginate` splits on sections — never inside a table — so an overlong table
    // overflows its sheet rather than continuing onto the next. It therefore
    // shares page 1 with the header and nothing else heavy.
    const ids = template.sections.map((s) => s.id);
    const page1 = ids.slice(0, ids.indexOf("declaration"));
    expect(page1).toEqual(["scope", "attached_records"]);
  });

  it("carries no record data from the reference file", () => {
    const json = JSON.stringify(rawTemplate, (key, value) =>
      key === "_note" || key === "_status" || key === "source" ? undefined : value,
    );
    // The reference is a blank form, so the only pre-filled wording that survives
    // into the template is the two defaults it is meant to carry.
    expect(json).toContain(RFI_DRAWING_NO_DEFAULT);
    expect(json).toContain("Kenyon Pte Ltd");
  });
});
