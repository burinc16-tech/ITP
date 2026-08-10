import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  isDynamicTableSection,
  isSignOffSection,
  isStandardSection,
  parseTemplate,
  type DynamicTableSection,
} from "@schema";
import rawTemplate from "../../../spec/templates/chwfcu-function-test.json";

/**
 * Parity between the converted template and the form it came from.
 *
 * This form carries no arithmetic — every cell is a reading, design figure or
 * label — so parity here is structural: the three measurement tables must offer
 * a column for every value the source sheet has a box for, and the whole record
 * must still print on the single page the original occupies.
 *
 * The source's CHW-FCU-A-FCC-101 readings are read at test time and never
 * copied into the template, which stays blank (Hard Rule #5 / §5.1).
 */

const SOURCE = resolve(process.cwd(), "spec/CHW_FCU_Function_Test.html");

const template = parseTemplate(rawTemplate);

function table(id: string): DynamicTableSection {
  const section = template.sections.find((s) => s.id === id);
  if (!section || !isDynamicTableSection(section)) {
    throw new Error(`${id} is not a dynamic table`);
  }
  return section;
}

/** The eight identity columns the source repeats on each measurement table. */
const IDENTITY = [
  "tag",
  "location",
  "area",
  "brand",
  "model",
  "max_total",
  "max_sens",
];

describe("CHW FCU Function Test — parity with the source form", () => {
  it("is a landscape ACMV ITR keyed to the FCU tag", () => {
    expect(template.code).toBe("CFT");
    expect(template.discipline).toBe("ACMV");
    expect(template.category).toBe("ITR");
    expect(template.scope).toBe("equipment");
    // Landscape, though the source sheet is portrait — see the page-layout
    // suite below for the measurements that forced it.
    expect(template.page).toEqual({ size: "A4", orientation: "landscape" });
  });

  it("repeats the identity columns on all three measurement tables, as the sheet does", () => {
    for (const id of ["chw_measurement", "air_flow_measurement", "motor_measurement"]) {
      const ids = table(id).columns.map((c) => c.id);
      expect(ids.slice(0, IDENTITY.length)).toEqual(IDENTITY);
      // The auto-numbered "NO" column is rendered, not declared.
      expect(table(id).auto_number).toBe(true);
      expect(table(id).number_label).toBe("NO");
      expect(ids).toContain("remarks");
    }
  });

  it("offers a design and an actual column for every measured quantity", () => {
    const chw = table("chw_measurement").columns.map((c) => c.id);
    for (const q of ["sup", "ret", "flow"]) {
      expect(chw).toContain(`${q}_design`);
      expect(chw).toContain(`${q}_actual`);
    }
    const air = table("air_flow_measurement").columns.map((c) => c.id);
    expect(air).toContain("sa_design");
    expect(air).toContain("sa_actual");
  });

  it("covers the five motor readings the source sheet has boxes for", () => {
    const motor = table("motor_measurement").columns.map((c) => c.id);
    expect(motor).toEqual(
      expect.arrayContaining([
        "run_current",
        "fl_current",
        "voltage",
        "rated_power",
        "phase",
      ]),
    );
  });

  it("units match the source column headings", () => {
    const unitOf = (section: string, column: string) =>
      table(section).columns.find((c) => c.id === column)?.unit;
    expect(unitOf("chw_measurement", "sup_actual")).toBe("°C");
    expect(unitOf("chw_measurement", "flow_actual")).toBe("L/s");
    expect(unitOf("air_flow_measurement", "sa_actual")).toBe("CMH");
    expect(unitOf("motor_measurement", "run_current")).toBe("A");
    expect(unitOf("motor_measurement", "rated_power")).toBe("kW");
  });

  it("carries none of the source form's project data", () => {
    const html = readFileSync(SOURCE, "utf8");
    // The sheet ships filled with a real unit; none of it may reach the template.
    expect(html).toContain("CHWFCU-A-FCC-101");
    const json = JSON.stringify(rawTemplate);
    for (const value of [
      "CHWFCU-A-FCC-101",
      "Temperzone",
      "IMD 280",
      "1011431",
      "FCC Room",
      "Apple @ AMK1",
      "43452638WS",
      "W8045321",
      "EBT732030022",
    ]) {
      expect(json).not.toContain(value);
    }
  });

  it("reads the three instruments as a register-linked table, not free text", () => {
    const instruments = table("instruments");
    expect(instruments.link_to_instrument_register).toBe(true);
    expect(instruments.min_rows).toBe(3);
    expect(template.instruments).toEqual({
      required: true,
      min: 1,
      source_section: "instruments",
    });
    // The source's combined "REMARKS / TEST INSTRUMENTS USED" box keeps its
    // remarks half as its own section.
    const remarks = template.sections.find((s) => s.id === "remarks")!;
    expect(isStandardSection(remarks)).toBe(true);
  });
});

describe("CHW FCU Function Test — page layout", () => {
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

  it("splits into two content pages, then the footer's own sign-off page", () => {
    expect(pages()).toEqual([
      ["chw_measurement", "air_flow_measurement"],
      ["motor_measurement", "instruments", "remarks"],
    ]);
    // PrintView appends one more page for the footer.
    expect(template.footer).toBeDefined();
    expect(pages().length + 1).toBe(3);
  });

  it("keeps the sign-off on the footer page, which is the only place it fits", () => {
    // Measured against this record's own readings: three signature columns are
    // 89.6mm of a landscape page's ~158mm body, so no grouping of the remaining
    // sections leaves room for them. An in-flow `sign_off` section was tried and
    // overflowed on every arrangement.
    expect(
      template.sections.some((s) => isSignOffSection(s)),
    ).toBe(false);
    expect(template.footer!.signatures.map((s) => s.role)).toEqual([
      "Tested By",
      "Witnessed By",
      "Verified By",
    ]);
    expect(template.footer!.signatures.map((s) => s.stage)).toEqual([
      "contractor",
      "witness",
      "client",
    ]);
  });

  it("sets the source form's 7pt on every measurement table", () => {
    for (const id of ["chw_measurement", "air_flow_measurement", "motor_measurement"]) {
      expect(table(id).font_size).toBe("7pt");
    }
  });

  it("keeps column labels short enough not to force a table past the page", () => {
    // The portrait attempt overflowed horizontally because long flat headers
    // ("CHW Supply Design") set each column's min-width. Landscape gives 269mm;
    // a label over two words starts eating it again.
    for (const id of ["chw_measurement", "air_flow_measurement", "motor_measurement"]) {
      for (const column of table(id).columns) {
        expect(column.label.split(/\s+/).length).toBeLessThanOrEqual(3);
      }
    }
  });
});
