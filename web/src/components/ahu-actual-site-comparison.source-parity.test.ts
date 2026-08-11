import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { isDynamicTableSection, isStandardSection, parseTemplate } from "@schema";
import rawTemplate from "../../../spec/templates/ahu-actual-site-comparison.json";

/**
 * Parity between the converted template and the sheet it came from.
 *
 * The source is a 404mm-wide A3 landscape sheet whose single CHILLED WATER AHU
 * table carries thirty columns under a three-deep nested header, plus a MOTOR
 * table with four fixed fan blocks. The app prints A4 and renders one flat
 * header row per column, so the conversion splits the first table into three and
 * turns the fan blocks into rows. These tests pin what that split must preserve:
 * every question the sheet asks, in the sheet's order, asked once.
 */

const SOURCE = resolve(process.cwd(), "spec/AHU_Actual_and_Site_Comparison.html");
const template = parseTemplate(rawTemplate);

/** Column ids of a dynamic-table section, in order. */
function columnIds(id: string): string[] {
  const section = template.sections.find((s) => s.id === id);
  if (!section || !isDynamicTableSection(section)) {
    throw new Error(`${id} is not a dynamic table section`);
  }
  return section.columns.map((c) => c.id);
}

describe("AHU Actual and Site Comparison — parity with the source sheet", () => {
  it("is a landscape ACMV ITR scoped to one AHU", () => {
    expect(template.code).toBe("ASC");
    expect(template.discipline).toBe("ACMV");
    expect(template.category).toBe("ITR");
    expect(template.scope).toBe("equipment");
    expect(template.page).toEqual({ size: "A4", orientation: "landscape" });
  });

  it("asks every heading of the sheet's two tables", () => {
    const html = readFileSync(SOURCE, "utf8");
    for (const heading of [
      "CHILLED WATER AHU",
      "Fresh Air Cooling Coil",
      "Return Air (Circulation) Cooling Coil",
      "Fresh Air Flow (CMH)",
      "Fresh air damper opening",
      "Static pressure set point",
      "Supply Air Flow (CMH)",
      "External Pressure (Pa)",
      "MOTOR",
      "REMARKS / TEST INSTRUMENTS USED",
    ]) {
      expect(html).toContain(heading);
    }
    const titles = template.sections.map((s) => s.title);
    expect(titles).toEqual([
      "Chilled Water AHU — Fresh Air Cooling Coil",
      "Chilled Water AHU — Return Air (Circulation) Cooling Coil",
      "Chilled Water AHU — Air Flow, Damper, Filter and Pressure",
      "Motor",
      "Test Instruments Used",
      "Remarks",
    ]);
  });

  it("asks the two cooling coils the same questions, in the sheet's order", () => {
    const coil = [
      "tag",
      "location",
      "area",
      "brand",
      "on_coil",
      "off_coil",
      "total_cooling",
      "chw_design",
      "chw_site",
      "flow_design",
      "flow_site",
      "pipe_size",
    ];
    expect(columnIds("fresh_air_coil")).toEqual(coil);
    expect(columnIds("return_air_coil")).toEqual(coil);
  });

  it("closes the CHW AHU row with the air flow block, remarks once", () => {
    expect(columnIds("air_flow")).toEqual([
      "tag",
      "location",
      "area",
      "brand",
      "fa_design",
      "fa_site",
      "damper",
      "static_sp",
      "sa_design",
      "sa_site",
      "filter",
      "ext_pressure",
      "remarks",
    ]);
    // The sheet has one Remarks column on the CHW AHU row, not three.
    const withRemarks = ["fresh_air_coil", "return_air_coil", "air_flow"].filter(
      (id) => columnIds(id).includes("remarks"),
    );
    expect(withRemarks).toEqual(["air_flow"]);
  });

  it("records the coil temperature pairs as text, as the sheet writes them", () => {
    const html = readFileSync(SOURCE, "utf8");
    expect(html).toContain("33.0 / 27.0");
    expect(html).toContain("8.0°C / 15.0°C");
    const section = template.sections.find((s) => s.id === "fresh_air_coil")!;
    if (!isDynamicTableSection(section)) throw new Error("not a dynamic table");
    for (const id of ["on_coil", "off_coil", "chw_design", "chw_site"]) {
      expect(section.columns.find((c) => c.id === id)!.type).toBe("text");
    }
  });

  it("carries no unit where the sheet's header states none", () => {
    const section = template.sections.find((s) => s.id === "air_flow")!;
    if (!isDynamicTableSection(section)) throw new Error("not a dynamic table");
    const unitOf = (id: string) =>
      section.columns.find((c) => c.id === id)!.unit;
    expect(unitOf("fa_design")).toBe("CMH");
    expect(unitOf("ext_pressure")).toBe("Pa");
    expect(unitOf("damper")).toBeUndefined();
    expect(unitOf("static_sp")).toBeUndefined();
  });

  it("turns the four fixed FAN blocks into one row per fan under the AHU", () => {
    const html = readFileSync(SOURCE, "utf8");
    for (const fan of ["FAN 1", "FAN 2", "FAN 3", "FAN 4"]) {
      expect(html).toContain(fan);
    }
    const section = template.sections.find((s) => s.id === "motor")!;
    if (!isDynamicTableSection(section)) throw new Error("not a dynamic table");
    expect(section.columns.map((c) => c.id)).toEqual([
      "fan",
      "l1",
      "l2",
      "l3",
      "voltage",
      "rpm",
    ]);
    expect(section.row_group?.columns.map((c) => c.id)).toEqual([
      "tag",
      "location",
      "area",
      "brand",
      "design_kw",
      "design_fla",
      "remarks",
    ]);
    // "6.21 x 3" is a rating and a fan count in one cell — not a number.
    expect(html).toContain("6.21 x 3");
    expect(
      section.row_group?.columns.find((c) => c.id === "design_kw")!.type,
    ).toBe("text");
  });

  it("tabulates the instruments box so the calibration register can read it", () => {
    expect(template.instruments).toEqual({
      required: true,
      min: 1,
      source_section: "instruments",
    });
    const section = template.sections.find((s) => s.id === "instruments")!;
    if (!isDynamicTableSection(section)) throw new Error("not a dynamic table");
    expect(section.link_to_instrument_register).toBe(true);
    // Four rows for the four instruments the source lists.
    expect(section.min_rows).toBe(4);
    const html = readFileSync(SOURCE, "utf8");
    for (const instrument of [
      "TRUE RMS MULTIMETER",
      "DIGITAL CLAMP METER",
      "BALOMETER",
      "AIRFLOW METER",
    ]) {
      expect(html).toContain(instrument);
    }
    // The serial numbers on the sheet are that job's, and must not be baked in.
    const json = JSON.stringify(rawTemplate);
    for (const serial of ["43452638WS", "W8045321", "EBT732030022"]) {
      expect(html).toContain(serial);
      expect(json).not.toContain(serial);
    }
  });

  it("keeps the sheet's free remarks box alongside the instruments table", () => {
    const section = template.sections.find((s) => s.id === "remarks")!;
    if (!isStandardSection(section)) throw new Error("not a standard section");
    expect(section.rows.map((r) => r.type)).toEqual(["textarea"]);
  });

  it("carries the sheet's three sign-off roles", () => {
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
    const html = readFileSync(SOURCE, "utf8");
    for (const role of ["Tested By", "Witnessed By", "Verified By"]) {
      expect(html).toContain(role);
    }
  });

  it("carries no project data from the filled sample sheet", () => {
    const html = readFileSync(SOURCE, "utf8");
    const json = JSON.stringify(rawTemplate, (key, value) =>
      key === "_note" || key === "_status" ? undefined : value,
    );
    for (const value of [
      "Apple @ AMK2 Level 1",
      "AHU-B-102",
      "Training RM / EOT Toilet / BOH",
      "EC Fan Speed 84.0%",
    ]) {
      expect(html).toContain(value);
      expect(json).not.toContain(value);
    }
  });
});

describe("AHU Actual and Site Comparison — page layout", () => {
  it("prints the three CHW AHU tables together, then the motor page", () => {
    const breaks = template.sections.map(
      (s) => (s as { page_break_before?: boolean }).page_break_before === true,
    );
    expect(breaks).toEqual([false, false, false, true, false, false]);
    // The sign-off is the top-level footer, which PrintView gives its own page.
    expect(template.footer).toBeDefined();
  });
});
