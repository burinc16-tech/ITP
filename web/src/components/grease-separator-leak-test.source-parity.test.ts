import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  isDynamicTableSection,
  isFieldGroupSection,
  isSignOffSection,
  isStandardSection,
  parseTemplate,
  type StandardSection,
} from "@schema";
import rawTemplate from "../../../spec/templates/grease-separator-leak-test.json";

/**
 * Parity between the converted template and the working form it came from.
 *
 * The source is a standalone HTML form that builds itself from one script block,
 * so its wording lives in JavaScript string arrays rather than in markup — the
 * checks below read those arrays out of the file and assert the template carries
 * them verbatim. That is the whole risk of this conversion: nine pre-test items
 * and seven leakage checks, any one of which could be quietly reworded into a
 * signed PDF the consultant did not approve (Hard Rule #5).
 *
 * The other thing pinned here is the outcome mapping in §9. "Visible leakage
 * observed" is the one question on the sheet whose good answer is No; read the
 * other way round, a leaking separator drops off the outstanding-items list.
 */

const SOURCE = resolve(
  process.cwd(),
  "spec/Grease_Separator_Watertightness_Leak_Test.html",
);
const template = parseTemplate(rawTemplate);
const html = readFileSync(SOURCE, "utf8");

/** The prose of a `const name=['…','…'];` array in the source's script block. */
function sourceList(name: string): string[] {
  const match = html.match(new RegExp(`const ${name}=\\[([^\\]]*)\\]`));
  if (!match) throw new Error(`no ${name} list in the source form`);
  return [...match[1]!.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) =>
    m[1]!.replace(/\\'/g, "'"),
  );
}

function standard(id: string): StandardSection {
  const section = template.sections.find((s) => s.id === id)!;
  if (!isStandardSection(section)) throw new Error(`${id} is not standard`);
  return section;
}

describe("Grease Separator leak test — parity with the source form", () => {
  it("is a portrait plumbing ITR scoped to the separator itself", () => {
    expect(template.code).toBe("GSL");
    expect(template.title).toBe(
      "Grease Separator – Watertightness / Leak Test Form",
    );
    expect(template.discipline).toBe("Plumbing & Sanitary");
    expect(template.category).toBe("ITR");
    // A separator has a tag; the sheet asks for it and makes it required.
    expect(template.scope).toBe("equipment");
    expect(template.page).toEqual({ size: "A4", orientation: "portrait" });
    expect(html).toContain("GREASE SEPARATOR");
    expect(html).toContain("WATERTIGHTNESS / LEAK TEST FORM");
  });

  it("carries the source's four document fields as the record header", () => {
    expect(template.header.fields.map((f) => f.label)).toEqual([
      "Form No.",
      "Revision",
      "Test Date",
      "Report No.",
    ]);
    for (const label of ["Form No.", "Revision", "Test Date", "Report No."]) {
      expect(html).toContain(`>${label}</div>`);
    }
  });

  it("keeps the source's ten numbered sections, in order", () => {
    const numbered = template.sections
      .filter((s) => (s as { no?: string }).no !== undefined)
      .map((s) => {
        // The sign-off section's title carries the certification sentence after
        // an em dash; only the heading itself is compared here.
        const title = (s as { title?: string }).title ?? "";
        return `${(s as { no?: string }).no}. ${title.split(" — ")[0]}`;
      });
    expect(numbered).toEqual([
      "1. Project Information",
      "2. Separator Details",
      "3. Pre-Test Inspection",
      "4. Test Conditions & Method",
      "5. Test Record",
      "6. Visual Leakage Inspection",
      "7. Test Equipment Used",
      "8. Observations, Defects & Remedial Action",
      "9. Test Result & Acceptance",
      "10. Certification & Sign-off",
    ]);
    for (const heading of [
      "1. PROJECT INFORMATION",
      "2. SEPARATOR DETAILS",
      "3. PRE-TEST INSPECTION",
      "4. TEST CONDITIONS &amp; METHOD",
      "5. TEST RECORD",
      "6. VISUAL LEAKAGE INSPECTION",
      "7. TEST EQUIPMENT USED",
      "8. OBSERVATIONS, DEFECTS &amp; REMEDIAL ACTION",
      "9. TEST RESULT &amp; ACCEPTANCE",
      "10. CERTIFICATION &amp; SIGN-OFF",
    ]) {
      expect(html).toContain(heading);
    }
  });

  it("carries the nine pre-test items verbatim, on the paper's Pass / Fail / N/A control", () => {
    const rows = standard("pre_test").rows;
    expect(rows.map((r) => r.description)).toEqual(sourceList("pre"));
    expect(rows).toHaveLength(9);
    for (const row of rows) {
      expect(row.type).toBe("pass_fail_na");
      expect(row.remarks).toBe(true);
      // Default wording IS Pass / Fail / N/A, which is the paper's own heading —
      // an override here would be a silent relabel.
      expect(row.labels).toBeUndefined();
    }
    expect(rows.map((r) => r.no)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
  });

  it("carries the seven leakage checks verbatim, on the same control", () => {
    const rows = standard("visual_leakage").rows;
    expect(rows.map((r) => r.description)).toEqual(sourceList("leak"));
    expect(rows).toHaveLength(7);
    for (const row of rows) {
      expect(row.type).toBe("pass_fail_na");
      expect(row.remarks).toBe(true);
    }
  });

  it("neither inspection list can be added to per record", () => {
    // The source has no add-row control on either list; an item added per record
    // would be checklist wording no consultant approved (Hard Rule #5). An
    // unforeseen finding goes in §8, which is a table that grows.
    for (const id of ["pre_test", "visual_leakage"]) {
      expect(standard(id).allow_add_rows).toBeUndefined();
      expect(standard(id).add_row_template).toBeUndefined();
    }
  });

  it("splits the source's two datetime pairs into a date and a time", () => {
    // The schema has `date` and `time` and no combined type.
    expect(html).toContain("field('Test Started (date / time)','test_started','datetime-local')");
    expect(html).toContain("field('Test Completed (date / time)','test_completed','datetime-local')");
    const conditions = template.sections.find((s) => s.id === "test_conditions")!;
    if (!isFieldGroupSection(conditions)) throw new Error("not a field group");
    const byId = new Map(conditions.fields.map((f) => [f.id, f]));
    expect(byId.get("test_started_date")!.type).toBe("date");
    expect(byId.get("test_started_time")!.type).toBe("time");
    expect(byId.get("test_completed_date")!.type).toBe("date");
    expect(byId.get("test_completed_time")!.type).toBe("time");

    const record = template.sections.find((s) => s.id === "test_record")!;
    if (!isDynamicTableSection(record)) throw new Error("not a dynamic table");
    expect(record.columns.slice(0, 2).map((c) => [c.id, c.type])).toEqual([
      ["reading_date", "date"],
      ["reading_time", "time"],
    ]);
    expect(html).toContain("Date / Time");
  });

  it("keeps units as field properties, never written into a label", () => {
    const units: Record<string, string> = {
      wet_volume: "l",
      sludge_volume: "l",
      chamber_depth: "m",
      test_head: "m",
      duration_required: "hrs",
      soak_period: "hrs",
      permissible_drop: "mm",
      ambient_temp: "°C",
      water_temp: "°C",
      loss_rate: "l/h",
    };
    const fields = template.sections
      .filter(isFieldGroupSection)
      .flatMap((s) => s.fields);
    for (const [id, unit] of Object.entries(units)) {
      const field = fields.find((f) => f.id === id)!;
      expect(field.unit).toBe(unit);
      expect(field.type).toBe("number");
      // The source writes the unit into the label; the renderer appends it here.
      expect(field.label).not.toContain("(");
    }
    expect(html).toContain("Total Wet Volume (l)");
    expect(html).toContain("Loss Rate (l/h)");
  });

  it("grows the three tables the paper draws at a fixed length", () => {
    const expected: Record<string, number> = {
      test_record: 5,
      test_equipment: 2,
      observations: 3,
    };
    for (const [id, min] of Object.entries(expected)) {
      const section = template.sections.find((s) => s.id === id)!;
      if (!isDynamicTableSection(section)) throw new Error(`${id} is not a table`);
      expect(section.min_rows).toBe(min);
      // Nothing is seeded — every cell of all three is the engineer's.
      expect(section.prefilled_rows).toBeUndefined();
    }
    // The source draws exactly that many rows with Array.from({length:n}).
    expect(html).toContain("Array.from({length:5}");
    expect(html).toContain("Array.from({length:2}");
    expect(html).toContain("Array.from({length:3}");
  });

  it("reads the level drop as typed, not derived", () => {
    // A formula resolves other columns of the SAME row; the start level lives in
    // the Test Summary block, so the sheet's arithmetic is not expressible here.
    const record = template.sections.find((s) => s.id === "test_record")!;
    if (!isDynamicTableSection(record)) throw new Error("not a dynamic table");
    const drop = record.columns.find((c) => c.id === "drop")!;
    expect(drop.type).toBe("number");
    expect(drop.formula).toBeUndefined();
    expect(record.totals).toBeUndefined();
  });

  it("maps the acceptance questions onto outcomes, leakage the reverse of the rest", () => {
    const rows = standard("result").rows;
    expect(rows.map((r) => r.id)).toEqual([
      "pretest_result",
      "drop_result",
      "visible_leakage",
      "overall_result",
      "retest_date",
    ]);

    const outcomes = (id: string) =>
      Object.fromEntries(
        rows.find((r) => r.id === id)!.states!.map((s) => [s.value, s.outcome]),
      );

    expect(outcomes("pretest_result")).toEqual({
      pass: "pass",
      fail: "fail",
      pass_comments: "pass",
    });
    expect(outcomes("drop_result")).toEqual({ yes: "pass", no: "fail" });
    // The one inversion on the sheet: seeing leakage is the failure.
    expect(outcomes("visible_leakage")).toEqual({ yes: "fail", no: "pass" });
    expect(outcomes("overall_result")).toEqual({
      pass: "pass",
      pass_conditions: "pass",
      fail_retest: "fail",
    });
    expect(rows.find((r) => r.id === "retest_date")!.type).toBe("date");

    // The source's own option words, from its resultRow() calls.
    for (const option of [
      "PASS WITH COMMENTS",
      "PASS WITH CONDITIONS",
      "FAIL / RETEST",
      "OVERALL RESULT",
    ]) {
      expect(html).toContain(option);
    }
  });

  it("wires the equipment table to the calibration register, due date and all", () => {
    const equipment = template.sections.find((s) => s.id === "test_equipment")!;
    if (!isDynamicTableSection(equipment)) throw new Error("not a dynamic table");
    expect(equipment.link_to_instrument_register).toBe(true);
    // The paper numbers its two instrument lines, as it numbers §8's rows.
    expect(equipment.auto_number).toBe(true);
    expect(equipment.number_label).toBe("No.");
    expect(html).toContain('<th class="num">No.</th>');
    expect(equipment.columns.map((c) => c.label)).toEqual([
      "Instrument / Equipment",
      "Make & Model",
      "Serial No.",
      "Calibration Due",
    ]);
    // Unusually for this library, the due date is the paper's own column.
    expect(html).toContain("Calibration Due");
    expect(template.instruments).toEqual({
      required: true,
      min: 1,
      source_section: "test_equipment",
    });
  });

  it("closes with the source's certification sentence and its three roles", () => {
    const signOff = template.sections.at(-1)!;
    if (!isSignOffSection(signOff)) throw new Error("last section is not sign-off");
    expect(signOff.no).toBe("10");
    expect(signOff.title).toContain(
      "We certify that the watertightness / leak test recorded above was carried out in the presence of the undersigned and that the results are a true record of the test performed.",
    );
    expect(html).toContain(
      "We certify that the watertightness / leak test recorded above was carried out in the presence of the undersigned and that the results are a true record of the test performed.",
    );
    expect(signOff.signatures.map((s) => [s.role, s.stage])).toEqual([
      ["Tested by (Contractor)", "contractor"],
      ["Witnessed by (Consultant)", "witness"],
      ["Accepted by (Client / Owner)", "client"],
    ]);
    // One sign-off block, in the flow — the footer would take a page of its own.
    expect(template.footer).toBeUndefined();

    // The paper's Designation row has nowhere to go: a slot captures role, name,
    // company and timestamp. Pinned so it is a decision, not an oversight.
    expect(html).toContain("Designation");
  });

  it("puts the attachment checkboxes above the signatures, not below them", () => {
    const ids = template.sections.map((s) => s.id);
    expect(ids.indexOf("attachments")).toBe(ids.indexOf("sign_off") - 1);
    const attachments = template.sections.find((s) => s.id === "attachments")!;
    if (!isFieldGroupSection(attachments)) throw new Error("not a field group");
    expect(attachments.fields.map((f) => f.type)).toEqual([
      "checkbox",
      "checkbox",
      "checkbox",
      "checkbox",
    ]);
    for (const name of [
      "attachment_manufacturer",
      "attachment_drawing",
      "attachment_calibration",
      "attachment_photos",
    ]) {
      expect(html).toContain(`name="${name}"`);
      expect(attachments.fields.some((f) => f.id === name)).toBe(true);
    }
  });

  it("breaks into five pages where the live build measured", () => {
    const breaks = template.sections.map(
      (s) => (s as { page_break_before?: boolean }).page_break_before === true,
    );
    // A break on the opening section is a no-op — it is already page 1 — and is
    // what stops `paginate` giving every section a sheet of its own.
    //
    // Measured on the live build, blank record, against the 878px an A4 page
    // gives its body:
    //   1  §1 + §2                                604px
    //   2  §3 + §4                                761px
    //   3  §5 + Test Summary + §6                 760px
    //   4  §7 + §8 + §9 + Remarks                 643px
    //   5  Attachments + §10 sign-off             631px
    //
    // The break before Attachments is load-bearing: one section earlier — before
    // §9 — the last page came to 974px and printed a sixth sheet while the footer
    // still read "of 5".
    expect(
      template.sections.map((s) => s.id).filter((_, i) => breaks[i]),
    ).toEqual(["project_info", "pre_test", "test_record", "test_equipment", "attachments"]);
  });

  it("carries none of the standalone form's own machinery", () => {
    const json = JSON.stringify(rawTemplate, (key, value) =>
      key === "_note" || key === "_status" || key === "source" ? undefined : value,
    );
    // Autosave, export/import, the clear button and the printed disclaimer all
    // belong to a file that had to survive on its own; the app carries serial
    // number, revision, page x of y and status in its own print footer (§7).
    for (const chrome of [
      "Export backup",
      "Clear form",
      "Uncontrolled when printed",
      "Autosave stores this form only in this browser",
    ]) {
      expect(html).toContain(chrome);
      expect(json).not.toContain(chrome);
    }
  });
});
