import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  isDynamicTableSection,
  isSignOffSection,
  isStandardSection,
  parseTemplate,
} from "@schema";
import rawTemplate from "../../../spec/templates/billi-tap-test.json";
import intercomRaw from "../../../spec/templates/fire-pwd-intercom-test.json";

/**
 * Parity between the converted template and the sheet it came from — and with
 * the sibling it shares a master with.
 *
 * The Billi tap report is the plumbing issue of the sheet already carried as
 * `fire-pwd-intercom-test` (FPI) and `toilet-emergency-call-test` (TEC): same
 * banner, same document block, same YES / N/A / NO readiness list, same
 * three-column sign-off. This pins the parts that must stay identical, and the
 * parts the tap sheet deliberately does differently.
 */

const SOURCE = resolve(process.cwd(), "spec/Billi_Tap_Test_Report.html");
const template = parseTemplate(rawTemplate);
const intercom = parseTemplate(intercomRaw);
const html = readFileSync(SOURCE, "utf8");

describe("Billi Tap Test Report — parity with the source sheet", () => {
  it("is a portrait plumbing ITR scoped to the area, not one item of equipment", () => {
    expect(template.code).toBe("PBT");
    expect(template.title).toBe("Check List & Test Report for P&S Billi Tap");
    expect(template.discipline).toBe("Plumbing & Sanitary");
    expect(template.category).toBe("ITR");
    expect(template.scope).toBe("location");
    expect(template.page).toEqual({ size: "A4", orientation: "portrait" });
    expect(html).toContain("Check List &amp; Test Report for<br>P&amp;S Billi Tap");
  });

  it("carries the paper's four readiness checks, less the job's area prefix", () => {
    const readiness = template.sections.find((s) => s.id === "readiness")!;
    if (!isStandardSection(readiness)) throw new Error("readiness is not standard");
    expect(readiness.rows.map((r) => r.description)).toEqual([
      "Solenoid valve has been provided and interlock with water leak detection system",
      "Drip tray has been provided",
      "Billi Tap-1 is working in order",
      "Billi Tap-2 is working in order",
    ]);
    // The first two are the sheet's verbatim; the tap ones drop its "L-4 Breakout
    // Area" prefix, which is that job's area and lives in the Location field.
    for (const description of readiness.rows.slice(0, 2).map((r) => r.description)) {
      expect(html).toContain(description);
    }
    for (const description of readiness.rows.slice(2).map((r) => r.description)) {
      expect(html).toContain(`L-4 Breakout Area ${description}`);
    }
    // Every check is ticked YES / N/A / NO, in the sheet's own order.
    for (const row of readiness.rows) {
      expect(row.type).toBe("status");
      expect(row.states?.map((s) => s.label)).toEqual(["Yes", "N/A", "No"]);
    }
    // A third tap's line is added as record data, never as template wording.
    expect(readiness.allow_add_rows).toBe(true);
    expect(readiness.add_row_template?.editable_no).toBe(true);
  });

  it("seeds the paper's four sub-tests against each of its two taps", () => {
    const taps = template.sections.find((s) => s.id === "taps")!;
    if (!isDynamicTableSection(taps)) throw new Error("taps is not a dynamic table");

    expect(taps.columns.map((c) => c.id)).toEqual([
      "tap",
      "test",
      "reading",
      "result",
    ]);
    // The paper's own two column headings, and its Passed / Failed wording.
    expect(taps.columns.map((c) => c.label)).toEqual([
      "Tap",
      "Test",
      "Reading",
      "Passed / Failed",
    ]);
    expect(taps.columns[3]!.states?.map((s) => s.label)).toEqual([
      "Passed",
      "Failed",
      "N/A",
    ]);

    const tests = ["Operation Voltage", "Operation Current", "Temperature (Hot)", "Flow Rate"];
    for (const test of tests) expect(html).toContain(test);
    expect(taps.prefilled_rows).toEqual([
      ...tests.map((test) => ({ tap: "Billi Tap-1", test })),
      ...tests.map((test) => ({ tap: "Billi Tap-2", test })),
    ]);
    // A reading is free text, as the sheet's own input is — no invented unit.
    expect(taps.columns[2]!.type).toBe("text");
    expect(taps.columns[2]!.unit).toBeUndefined();
    expect(taps.min_rows).toBe(4); // one tap's worth is the floor
  });

  it("splits the paper's instrument lines into the library's instrument table", () => {
    const instruments = template.sections.find((s) => s.id === "instruments")!;
    if (!isDynamicTableSection(instruments)) {
      throw new Error("instruments is not a dynamic table");
    }
    expect(html).toContain("REMARKS: Instruments used;");
    expect(instruments.link_to_instrument_register).toBe(true);
    expect(instruments.min_rows).toBe(3); // the three lines the sheet lists
    expect(template.instruments).toEqual({
      required: true,
      min: 1,
      source_section: "instruments",
    });
  });

  it("carries no record data from the sheet", () => {
    const json = JSON.stringify(rawTemplate, (key, value) =>
      key === "_note" || key === "_status" || key === "source" ? undefined : value,
    );
    // The file arrived seeded with one job's values — the project, the area, the
    // two tap names and the three instruments with their serial numbers. None of
    // it belongs in a template that ships blank.
    for (const value of [
      "APPLE AMK3 Level 6 (Phase 2)",
      "Breakout Area",
      "L-4 Breakout Area Billi Tap-1",
      "E1034007017",
      "43452638WS",
      "W8045321",
    ]) {
      expect(html).toContain(value);
      expect(json).not.toContain(value);
    }
  });
});

describe("Billi Tap Test Report — kept in step with the intercom sibling", () => {
  it("shares the master sheet's document block and sign-off", () => {
    expect(template.header.fields.map((f) => f.id)).toEqual(
      intercom.header.fields.map((f) => f.id),
    );
    expect(template.header.fields.map((f) => f.label)).toEqual(
      intercom.header.fields.map((f) => f.label),
    );

    const mine = template.sections.find((s) => isSignOffSection(s))!;
    const theirs = intercom.sections.find((s) => isSignOffSection(s))!;
    if (!isSignOffSection(mine) || !isSignOffSection(theirs)) {
      throw new Error("both templates sign off in the section flow");
    }
    expect(mine.signatures.map((s) => s.role)).toEqual(
      theirs.signatures.map((s) => s.role),
    );
    expect(mine.signatures.map((s) => s.stage)).toEqual(
      theirs.signatures.map((s) => s.stage),
    );
    expect(template.footer).toBeUndefined();
  });

  it("differs where the tap sheet's own test does", () => {
    expect(template.code).not.toBe(intercom.code);
    expect(template.discipline).not.toBe(intercom.discipline);
    // The intercom sheet has no instruments and no remarks box; the tap sheet has both.
    expect(intercom.instruments).toBeUndefined();
    expect(template.sections.map((s) => s.id)).toEqual([
      "readiness",
      "taps",
      "instruments",
      "remarks",
      "sign_off",
    ]);
  });
});

describe("Billi Tap Test Report — page layout", () => {
  it("prints the checks and the taps, then the instruments, remarks and sign-off", () => {
    const breaks = template.sections.map(
      (s) => (s as { page_break_before?: boolean }).page_break_before === true,
    );
    // A break on the opening section is a no-op — it is already page 1 — and is
    // what stops `paginate` giving every section a sheet of its own. The only
    // real break is before the instruments: measured on the live build, a
    // two-tap record with them on page 1 came to 1157px against A4's 1122.5px.
    expect(breaks).toEqual([true, false, true, false, false]);
  });
});
