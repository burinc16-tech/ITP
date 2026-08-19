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
import rawTemplate from "../../../spec/templates/grease-separator-functional-test.json";
import leakRaw from "../../../spec/templates/grease-separator-leak-test.json";

/**
 * Parity between the converted template and the working form it came from — and
 * with `grease-separator-leak-test` (GSL), the other half of the pair. GSL proves
 * the vessel holds water; this proves it works, and the two are filled on the
 * same unit by the same engineer.
 *
 * As with GSL, the source builds its checklists from JavaScript string arrays, so
 * the checks below read those arrays out of the file and assert the template
 * carries them verbatim — twenty-seven items across three lists, any one of which
 * could be quietly reworded into a signed PDF (Hard Rule #5).
 *
 * What is pinned against the sibling is the shared vocabulary: where both forms
 * ask the same question they must use the same field id, or a project running
 * both reads as two unrelated documents in an export.
 */

const SOURCE = resolve(
  process.cwd(),
  "spec/Grease_Separator_Functional_Performance_Test.html",
);
const template = parseTemplate(rawTemplate);
const leak = parseTemplate(leakRaw);
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

function table(id: string) {
  const section = template.sections.find((s) => s.id === id)!;
  if (!isDynamicTableSection(section)) throw new Error(`${id} is not a table`);
  return section;
}

describe("Grease Separator functional test — parity with the source form", () => {
  it("is a portrait plumbing ITR scoped to the separator itself", () => {
    expect(template.code).toBe("GSF");
    expect(template.title).toBe(
      "Grease Separator – Functional & Performance Test Form",
    );
    expect(template.discipline).toBe("Plumbing & Sanitary");
    expect(template.category).toBe("ITR");
    expect(template.scope).toBe("equipment");
    expect(template.page).toEqual({ size: "A4", orientation: "portrait" });
    expect(html).toContain("GREASE SEPARATOR");
    expect(html).toContain("FUNCTIONAL &amp; PERFORMANCE TEST FORM");
  });

  it("keeps the source's twelve numbered sections, in order", () => {
    const numbered = template.sections
      .filter((s) => (s as { no?: string }).no !== undefined)
      .map((s) => {
        const title = (s as { title?: string }).title ?? "";
        return `${(s as { no?: string }).no}. ${title.split(" — ")[0]}`;
      });
    expect(numbered).toEqual([
      "1. Project Information",
      "2. Equipment & Design Data",
      "3. Pre-Test Readiness Checks",
      "4. Test Conditions",
      "5. Performance Measurements",
      "6. Operational Checks Under Flow",
      "7. Alarm, Control & Ancillary Function Test",
      "8. Effluent Sampling (Where Required)",
      "9. Test Equipment Used",
      "10. Observations, Defects & Outstanding Works",
      "11. Overall Test Result & Acceptance",
      "12. Certification & Sign-off",
    ]);
    for (const heading of [
      "1. PROJECT INFORMATION",
      "2. EQUIPMENT &amp; DESIGN DATA",
      "3. PRE-TEST READINESS CHECKS",
      "4. TEST CONDITIONS",
      "5. PERFORMANCE MEASUREMENTS",
      "6. OPERATIONAL CHECKS UNDER FLOW",
      "7. ALARM, CONTROL &amp; ANCILLARY FUNCTION TEST",
      "8. EFFLUENT SAMPLING (WHERE REQUIRED)",
      "9. TEST EQUIPMENT USED",
      "10. OBSERVATIONS, DEFECTS &amp; OUTSTANDING WORKS",
      "11. OVERALL TEST RESULT &amp; ACCEPTANCE",
      "12. CERTIFICATION &amp; SIGN-OFF",
    ]) {
      expect(html).toContain(heading);
    }
  });

  it("carries all twenty-seven checklist items verbatim", () => {
    const lists: [string, string, number][] = [
      ["readiness", "readiness", 10],
      ["operational", "operational", 8],
      ["alarm", "alarm", 9],
    ];
    for (const [sectionId, listName, count] of lists) {
      const rows = standard(sectionId).rows;
      expect(rows.map((r) => r.description)).toEqual(sourceList(listName));
      expect(rows).toHaveLength(count);
      for (const row of rows) {
        expect(row.type).toBe("pass_fail_na");
        expect(row.remarks).toBe(true);
        // Default wording IS Pass / Fail / N/A, the paper's own heading.
        expect(row.labels).toBeUndefined();
      }
      // The source has no add-row control on any of the three lists.
      expect(standard(sectionId).allow_add_rows).toBeUndefined();
    }
  });

  it("ties the record to its watertightness sibling in the first readiness item", () => {
    // This test is not valid until GSL has been accepted, and the paper says so.
    expect(standard("readiness").rows[0]!.description).toBe(
      "Watertightness / leak test completed and accepted (report attached)",
    );
    const attachments = template.sections.find((s) => s.id === "attachments")!;
    if (!isFieldGroupSection(attachments)) throw new Error("not a field group");
    expect(attachments.fields[0]).toEqual({
      id: "attachment_watertightness",
      label: "Watertightness test report",
      type: "checkbox",
    });
    expect(html).toContain('name="attachment_watertightness"');
  });

  it("seeds the twelve performance parameters with the paper's own units", () => {
    const measurements = table("measurements");
    expect(measurements.min_rows).toBe(12);
    expect(measurements.auto_number).toBe(true);
    expect(measurements.columns.map((c) => c.label)).toEqual([
      "Parameter",
      "Design / Specified",
      "Measured / Actual",
      "Unit",
      "Accept / Reject",
    ]);

    // The source's `measures` array is [parameter, unit] pairs.
    const pairs = [
      ...html.matchAll(/\['((?:[^'\\]|\\.)*)','(l\/s|mm|min|l|°C|s)'\]/g),
    ].map((m) => ({ parameter: m[1]!.replace(/\\'/g, "'"), unit: m[2]! }));
    expect(pairs).toHaveLength(12);
    expect(measurements.prefilled_rows).toEqual(pairs);

    // Unit is a seeded ROW VALUE, not a column-level `unit` — the twelve rows
    // carry six different units, so a column unit would print one heading for
    // all of them. The source prints it as fixed text in each row, not an input.
    expect(measurements.columns.find((c) => c.id === "unit")!.unit).toBeUndefined();
    expect(new Set(pairs.map((p) => p.unit))).toEqual(
      new Set(["l/s", "mm", "min", "l", "°C", "s"]),
    );

    // Design and Measured stay free text: a bound is written "≥ 2.0" as often
    // as a figure, and `number` would force a unit into the heading.
    for (const id of ["design", "actual"]) {
      expect(measurements.columns.find((c) => c.id === id)!.type).toBe("text");
    }
  });

  it("seeds the five sampling parameters with their units inside the text", () => {
    const samples = table("sample_results");
    expect(samples.min_rows).toBe(5);
    // The one table on this form the paper does not number.
    expect(samples.auto_number).toBeUndefined();
    expect(html).not.toContain('<th class="num">No.</th>\n<th>Parameter</th>');

    const listed = sourceList("samples");
    expect(samples.prefilled_rows).toEqual(listed.map((parameter) => ({ parameter })));
    // Units live in the row TEXT here, not as a field property — these are row
    // data, where §2's are field definitions. Opposite call, on purpose.
    expect(listed[0]).toBe("Oil & Grease / FOG (mg/l)");
    expect(listed[4]).toBe("Other");
  });

  it("splits the source's three datetime fields into a date and a time", () => {
    for (const name of ["condition_datetime", "sample_datetime"]) {
      expect(html).toContain(`'${name}','datetime-local'`);
    }
    const fields = template.sections
      .filter(isFieldGroupSection)
      .flatMap((s) => s.fields);
    const byId = new Map(fields.map((f) => [f.id, f]));
    const pairs: [string, string][] = [
      ["condition_date", "condition_time"],
      ["sample_date", "sample_time"],
    ];
    for (const [dateId, timeId] of pairs) {
      expect(byId.get(dateId)!.type).toBe("date");
      expect(byId.get(timeId)!.type).toBe("time");
    }
  });

  it("carries the source's radio groups as dropdowns, values verbatim", () => {
    const fields = template.sections
      .filter(isFieldGroupSection)
      .flatMap((s) => s.fields);
    const options = (id: string) => fields.find((f) => f.id === id)!.options;
    expect(options("vent")).toEqual(["Provided", "Not provided"]);
    expect(options("alarm_fitted")).toEqual(["Yes", "No"]);
    expect(options("flow_source")).toEqual(["Kitchen fixtures", "Hose / tanker"]);
    // Including the run-together spelling the source uses.
    expect(options("test_substance")).toEqual(["None", "Oil/grease", "Dye"]);
    expect(html).toContain("['None','Oil/grease','Dye']");
  });

  it("maps the seven acceptance rows onto outcomes, none of them inverted", () => {
    const rows = standard("result").rows;
    expect(rows.map((r) => r.id)).toEqual([
      "result_readiness",
      "result_performance",
      "result_operational",
      "result_alarm",
      "result_sampling",
      "overall_result",
      "retest_date",
    ]);

    // Each section verdict points back at the checks that produced it.
    expect(
      rows.slice(0, 5).map((r) => r.cross_ref),
    ).toEqual(["readiness", "measurements", "operational", "alarm", "sample_results"]);
    for (const ref of rows.slice(0, 5).map((r) => r.cross_ref!)) {
      expect(template.sections.some((s) => s.id === ref)).toBe(true);
    }

    for (const row of rows.slice(0, 5)) {
      expect(
        Object.fromEntries(row.states!.map((s) => [s.value, s.outcome])),
      ).toEqual({ pass: "pass", fail: "fail", na: "na" });
    }
    // ACCEPTED WITH CONDITIONS is still an acceptance; the conditions live in §10.
    expect(
      Object.fromEntries(
        rows.find((r) => r.id === "overall_result")!.states!.map((s) => [s.value, s.outcome]),
      ),
    ).toEqual({
      accepted: "pass",
      accepted_conditions: "pass",
      rejected_retest: "fail",
    });
    expect(rows.find((r) => r.id === "retest_date")!.type).toBe("date");

    for (const word of [
      "ACCEPTED WITH CONDITIONS",
      "REJECTED / RETEST",
      "OVERALL RESULT",
    ]) {
      expect(html).toContain(word);
    }
  });

  it("wires the equipment table to the calibration register", () => {
    const equipment = table("test_equipment");
    expect(equipment.link_to_instrument_register).toBe(true);
    expect(equipment.auto_number).toBe(true);
    // Twice GSL's floor: this test needs a flow meter and a thermometer too.
    expect(equipment.min_rows).toBe(4);
    expect(html).toContain("Array.from({length:4}");
    expect(template.instruments).toEqual({
      required: true,
      min: 1,
      source_section: "test_equipment",
    });
  });

  it("closes with the source's certification sentence — plural, as written", () => {
    const signOff = template.sections.at(-1)!;
    if (!isSignOffSection(signOff)) throw new Error("last section is not sign-off");
    expect(signOff.no).toBe("12");
    const sentence =
      "We certify that the functional and performance tests recorded above were carried out in the presence of the undersigned and that the results are a true record of the tests performed.";
    expect(signOff.title).toContain(sentence);
    expect(html).toContain(sentence);
    expect(template.footer).toBeUndefined();
  });

  it("puts the attachment checkboxes above the signatures, not below them", () => {
    const ids = template.sections.map((s) => s.id);
    expect(ids.indexOf("attachments")).toBe(ids.indexOf("sign_off") - 1);
    const attachments = template.sections.find((s) => s.id === "attachments")!;
    if (!isFieldGroupSection(attachments)) throw new Error("not a field group");
    expect(attachments.fields).toHaveLength(5);
    for (const f of attachments.fields) expect(f.type).toBe("checkbox");
  });

  it("breaks into seven pages where the live build measured", () => {
    const breaks = template.sections.map(
      (s) => (s as { page_break_before?: boolean }).page_break_before === true,
    );
    // A break on the opening section is a no-op — it is already page 1 — and is
    // what stops `paginate` giving every section a sheet of its own.
    //
    // Measured on the live build, blank record, against the 878px an A4 page
    // gives its body. Block heights: §1 322, §2 328, §3 433, §4 217, §5 580,
    // §6 363, §7 398, §8 132 + 280 + 105, §9 222, §10 222, §11 328, Remarks 86,
    // Attachments 151, §12 480 — 4647px in all, which is six pages of content
    // that the fixed section order packs into seven.
    //
    //   1  §1 + §2                                       650px  (228 spare)
    //   2  §3 + §4                                       650px  (228 spare)
    //   3  §5                                            580px  (298 spare)
    //   4  §6 + §7                                       761px  (117 spare)
    //   5  §8 + Sample Results + Laboratory + §9          739px  (139 spare)
    //   6  §10 + §11 + Remarks                           636px  (242 spare)
    //   7  Attachments + §12 sign-off                    631px  (247 spare)
    //
    // Two of these breaks are load-bearing. Before §6: with §5 and §6 together
    // the page came to 943px and printed an eighth sheet while the footer read
    // "of 7". Before §10: with the break before §9 instead, that page came to
    // 858px — inside A4, but one added instrument row from spilling.
    //
    // The spare column is where the growth is: §5, §9, the sample table and §10
    // all take added rows; §3, §6, §7 and §11 are fixed and cannot.
    expect(
      template.sections.map((s) => s.id).filter((_, i) => breaks[i]),
    ).toEqual([
      "project_info",
      "readiness",
      "measurements",
      "operational",
      "sampling",
      "observations",
      "attachments",
    ]);
  });

  it("carries none of the standalone form's own machinery", () => {
    const json = JSON.stringify(rawTemplate, (key, value) =>
      key === "_note" || key === "_status" || key === "source" ? undefined : value,
    );
    for (const chrome of [
      "Export backup",
      "Clear form",
      "Autosave stores this form only in this browser",
    ]) {
      expect(html).toContain(chrome);
      expect(json).not.toContain(chrome);
    }
  });
});

describe("Grease Separator functional test — kept in step with its GSL sibling", () => {
  it("shares a field vocabulary wherever both forms ask the same question", () => {
    const idsOf = (t: typeof template) =>
      new Set([
        ...t.header.fields.map((f) => f.id),
        ...t.sections.filter(isFieldGroupSection).flatMap((s) => s.fields.map((f) => f.id)),
      ]);
    const mine = idsOf(template);
    // A project running both records must read as one document set in an export.
    for (const shared of [
      "form_no",
      "revision",
      "test_date",
      "report_no",
      "project_name",
      "project_no",
      "site_location",
      "building_block",
      "client_owner",
      "consultant",
      "main_contractor",
      "testing_contractor",
      "separator_id",
      "unit_location",
      "manufacturer",
      "model_type",
      "serial_no",
      "nominal_size",
      "sludge_volume",
      "wet_volume",
      "inlet_pipe",
      "outlet_pipe",
      "reference_standard",
      "approved_drawing",
      "ambient_temp",
      "overall_remarks",
    ]) {
      expect(idsOf(leak).has(shared)).toBe(true);
      expect(mine.has(shared)).toBe(true);
    }
  });

  it("shares the sign-off roles, stages and Kenyon default", () => {
    const mine = template.sections.find(isSignOffSection)!;
    const theirs = leak.sections.find(isSignOffSection)!;
    if (!isSignOffSection(mine) || !isSignOffSection(theirs)) {
      throw new Error("both templates sign off in the section flow");
    }
    // One workflow across the pair (SPEC §6).
    expect(mine.signatures).toEqual(theirs.signatures);
  });

  it("differs where the functional test does: measurements, alarms, sampling", () => {
    const leakIds = new Set(leak.sections.map((s) => s.id));
    for (const own of ["measurements", "operational", "alarm", "sampling", "sample_results", "laboratory"]) {
      expect(template.sections.some((s) => s.id === own)).toBe(true);
      expect(leakIds.has(own)).toBe(false);
    }
    // And GSL's reading table has no counterpart here — that test watches a level
    // fall over hours; this one measures a unit under flow.
    expect(leakIds.has("test_record")).toBe(true);
    expect(template.sections.some((s) => s.id === "test_record")).toBe(false);
  });
});
