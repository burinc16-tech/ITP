import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  isFieldGroupSection,
  isSignOffSection,
  isStandardSection,
  parseTemplate,
} from "@schema";
import rawTemplate from "../../../spec/templates/fcu-lcp-checklist.json";
import { interpolate } from "../lib/interpolate";

/**
 * Parity between the converted template and the sheet it came from.
 *
 * The source ships eight worded checks followed by three blank numbered rows;
 * this asserts the wording is carried across verbatim and that the blanks became
 * `allow_add_rows` rather than empty template rows (SPEC §12, Hard Rule #5).
 *
 * The sheet's filled-in reference and location are read at test time and must
 * not appear in the template.
 */

const SOURCE = resolve(process.cwd(), "spec/FCU_LCP_Checklist.html");
const template = parseTemplate(rawTemplate);

const checks = template.sections.find((s) => s.id === "checks")!;
if (!isStandardSection(checks)) throw new Error("checks is not a standard section");

/** The worded `<div class="desc-text">` items of the source sheet, in order. */
function sourceItems(): string[] {
  const html = readFileSync(SOURCE, "utf8");
  return [...html.matchAll(/<div class="desc-text">([^<]*)<\/div>/g)].map((m) =>
    m[1]!.replace(/&amp;/g, "&").trim(),
  );
}

describe("FCU LCP Checklist — parity with the source sheet", () => {
  it("is a portrait ACMV ITR keyed to the panel reference", () => {
    expect(template.code).toBe("LCP");
    expect(template.discipline).toBe("ACMV");
    expect(template.category).toBe("ITR");
    expect(template.page).toEqual({ size: "A4", orientation: "portrait" });
    const ref = template.header.fields.find((f) => f.id === "ref_code")!;
    expect(ref.source).toBe("equipment.tag");
    expect(ref.required).toBe(true);
  });

  it("carries all eight worded checks, and only those", () => {
    expect(sourceItems()).toHaveLength(8);
    expect(checks.rows).toHaveLength(8);
    expect(checks.rows.map((r) => r.no)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
  });

  it("answers Yes / No / NA on every row, as the sheet heads its columns", () => {
    for (const row of checks.rows) {
      expect(row.type).toBe("status");
      expect(row.states?.map((s) => s.label)).toEqual(["Yes", "No", "NA"]);
      // A "No" answer must be derivable as an outstanding item (SPEC §6).
      expect(row.states?.map((s) => s.outcome)).toEqual(["pass", "fail", "na"]);
      expect(row.remarks).toBe(true);
    }
  });

  it("turns the sheet's three blank rows into add-your-own rows", () => {
    // The source numbers 9, 10 and 11 with empty description inputs. None of
    // them may exist as template rows — an engineer's wording is record data.
    expect(checks.allow_add_rows).toBe(true);
    expect(checks.add_row_template?.type).toBe("status");
    expect(checks.add_row_template?.states?.map((s) => s.label)).toEqual([
      "Yes",
      "No",
      "NA",
    ]);
    expect(checks.add_row_template?.remarks).toBe(true);
    expect(checks.add_row_template?.editable_no).toBe(true);
  });

  it("makes the damper count a variable rather than baking in \"2 nos\"", () => {
    const source = sourceItems().find((i) => /Motorized Damper/i.test(i))!;
    expect(source).toContain("2 nos");

    const row = checks.rows.find((r) => r.id === "lcp_05")!;
    expect(row.description).toContain("{{damper_qty}}");

    const variable = template.variables!.find((v) => v.id === "damper_qty")!;
    expect(variable.type).toBe("number");
    expect(variable.default).toBe(2);
    // Resolved against the default, the row reads as the sheet does.
    expect(interpolate(row.description, { damper_qty: "2" })).toContain("2 nos");
  });

  it("records the sheet's V / LOW / MED / HIGH strip", () => {
    const measurements = template.sections.find((s) => s.id === "measurements")!;
    expect(isFieldGroupSection(measurements)).toBe(true);
    if (!isFieldGroupSection(measurements)) return;
    expect(measurements.fields.map((f) => f.id)).toEqual([
      "voltage",
      "current_low",
      "current_med",
      "current_high",
    ]);
    expect(measurements.fields.map((f) => f.unit)).toEqual(["V", "A", "A", "A"]);
  });

  it("carries none of the sheet's project data", () => {
    const json = JSON.stringify(rawTemplate);
    for (const value of ["LCP-CHW-FCU-A-MDF-109", "Apple, Level-1", "AMK-3"]) {
      expect(readFileSync(SOURCE, "utf8")).toContain(value);
      expect(json).not.toContain(value);
    }
  });
});

describe("FCU LCP Checklist — page layout", () => {
  /** `paginate` in print-view.tsx: a new page starts at each flagged section. */
  function pages(): string[][] {
    const out: string[][] = [];
    for (const s of template.sections) {
      const brk = (s as { page_break_before?: boolean }).page_break_before;
      if (out.length === 0 || brk) out.push([s.id]);
      else out[out.length - 1]!.push(s.id);
    }
    return out;
  }

  it("gives the checklist its own page so added rows have somewhere to go", () => {
    expect(pages()).toEqual([
      ["checks"],
      ["measurements", "remarks", "sign_off"],
    ]);
    // Measured with all eight checks answered and commented: page 1 uses
    // 156.5mm of 245mm, leaving ~88mm — about six added rows before it spills.
    // Everything on one page measured 382.1mm against 297mm.
  });

  it("keeps the sign-off in the flow rather than on a footer page of its own", () => {
    expect(template.footer).toBeUndefined();
    const signOff = template.sections.at(-1)!;
    expect(isSignOffSection(signOff)).toBe(true);
    if (!isSignOffSection(signOff)) return;
    expect(signOff.signatures.map((s) => s.company_default)).toEqual([
      "Kenyon Pte Ltd",
      "T&C Consultant",
      "Client",
    ]);
    expect(signOff.signatures.map((s) => s.stage)).toEqual([
      "contractor",
      "witness",
      "client",
    ]);
  });
});
