import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { isDynamicTableSection, isSignOffSection, parseTemplate } from "@schema";
import rawTemplate from "../../../spec/templates/meter-verification-record.json";
import sensorRaw from "../../../spec/templates/sensor-calibration-record.json";
import { evaluateFormula } from "../lib/formula";

/**
 * Parity between the converted template and the sheet it came from — and with
 * `sensor-calibration-record` (SCR), the sheet it is closest to: both compare a
 * BMS figure against a measured one and record the offset between them. What the
 * meter sheet does differently — a fixed m³ unit, numeric readings and a derived
 * offset — is pinned here, so a later edit that quietly aligns the two has to
 * fail a test rather than reach a signed PDF.
 */

const SOURCE = resolve(process.cwd(), "spec/Meter_Verification_Record.html");
const template = parseTemplate(rawTemplate);
const sensor = parseTemplate(sensorRaw);
const html = readFileSync(SOURCE, "utf8");

describe("Meter Verification Record — parity with the source sheet", () => {
  it("is a portrait plumbing ITR scoped to the riser, not one item of equipment", () => {
    expect(template.code).toBe("MVR");
    expect(template.title).toBe("Energy / Water Meter Verification Record");
    expect(template.discipline).toBe("Plumbing & Sanitary");
    expect(template.category).toBe("ITR");
    expect(template.scope).toBe("location");
    expect(template.page).toEqual({ size: "A4", orientation: "portrait" });
    expect(html).toContain("ENERGY / WATER METER VERIFICATION RECORD");
  });

  it("carries the sheet's three document fields and nothing more", () => {
    expect(template.header.fields.map((f) => f.label)).toEqual([
      "Project",
      "Ref No",
      "Date",
    ]);
    for (const label of ["PROJECT:", "REF NO:", "DATE:"]) {
      expect(html).toContain(label);
    }
    // Project is asked for, not inherited: `source` + `readonly` is declared on
    // other templates but nothing populates it, so such a cell prints blank.
    const project = template.header.fields[0]!;
    expect(project.readonly).toBeUndefined();
    expect(project.source).toBeUndefined();
  });

  it("carries the sheet's seven columns, with its m³ unit on the three readings", () => {
    const meters = template.sections.find((s) => s.id === "meters")!;
    if (!isDynamicTableSection(meters)) throw new Error("meters is not a dynamic table");

    expect(meters.auto_number).toBe(true);
    expect(meters.number_label).toBe("S/N"); // the paper's own first column
    expect(meters.columns.map((c) => c.label)).toEqual([
      "Room / Location",
      "Meter ID",
      "BMS Reading",
      "Meter Reading",
      "Offset",
      "Remarks",
    ]);
    for (const heading of [
      "Room / Location",
      "Meter ID",
      "BMS Reading",
      "Meter Reading",
      "Offset",
      "Remarks",
    ]) {
      expect(html).toContain(heading);
    }
    // The paper's second header row — "(m³)" under each of the three figures —
    // is a `unit`, which the renderer appends to the heading instead.
    expect(html).toContain("(m&sup3;)");
    for (const id of ["bms", "meter", "offset"]) {
      expect(meters.columns.find((c) => c.id === id)!.unit).toBe("m³");
    }
  });

  it("derives the offset the sheet leaves typed, and reproduces its sample arithmetic", () => {
    const meters = template.sections.find((s) => s.id === "meters")!;
    if (!isDynamicTableSection(meters)) throw new Error("meters is not a dynamic table");
    const offset = meters.columns.find((c) => c.id === "offset")!;
    expect(offset.type).toBe("calculated");
    expect(offset.formula).toBe("meter - bms");
    expect(offset.decimals).toBe(2);

    // The two rows the sheet arrived filled in with.
    expect(evaluateFormula(offset.formula!, { bms: 6.65, meter: 6.7 })).toBeCloseTo(0.05, 5);
    expect(evaluateFormula(offset.formula!, { bms: 11.1, meter: 11.1 })).toBe(0);
    // A row with nothing in it prints an empty offset, not 0.00.
    expect(evaluateFormula(offset.formula!, { bms: "", meter: "" })).toBeNull();
  });

  it("carries no record data from the sheet", () => {
    const json = JSON.stringify(rawTemplate, (key, value) =>
      key === "_note" || key === "_status" || key === "source" ? undefined : value,
    );
    // The file arrived saved with one job's record in it; the template ships blank.
    for (const value of [
      "Apple AMK 2 Level 4",
      "P&amp;S-08",
      "2024-11-07",
      "L-4 P&S Riser",
      "NWM-B-401",
      "CWM-B-401",
      "L-4 New Water Meter",
    ]) {
      expect(html).toContain(value);
      expect(json).not.toContain(value.replace("&amp;", "&"));
    }
  });
});

describe("Meter Verification Record — kept in step with the sensor sibling", () => {
  it("shares its shape: one reading table, a remarks box, a three-row sign-off", () => {
    expect(template.sections.map((s) => s.type)).toEqual([
      "dynamic_table",
      "field_group",
      "sign_off",
    ]);
    const mine = template.sections.find((s) => isSignOffSection(s))!;
    const theirs = sensor.sections.find((s) => isSignOffSection(s))!;
    if (!isSignOffSection(mine) || !isSignOffSection(theirs)) {
      throw new Error("both templates sign off in the section flow");
    }
    expect(mine.signatures).toEqual(theirs.signatures);
    expect(template.footer).toBeUndefined();
  });

  it("prints the table and remarks, then the sign-off", () => {
    const breaks = template.sections.map(
      (s) => (s as { page_break_before?: boolean }).page_break_before === true,
    );
    // A break on the opening section is a no-op — it is already page 1 — and is
    // what stops `paginate` giving every section a sheet of its own. The real
    // break is before the sign-off: measured on the live build, a three-meter
    // record with the grid on page 1 came to 1225px against A4's 1122.5px.
    expect(breaks).toEqual([true, false, true]);
  });

  it("differs where the meter sheet does: fixed unit, numbers, no instruments", () => {
    const mine = template.sections.find((s) => s.id === "meters")!;
    const theirs = sensor.sections.find((s) => s.id === "readings")!;
    if (!isDynamicTableSection(mine) || !isDynamicTableSection(theirs)) {
      throw new Error("both reading blocks are dynamic tables");
    }
    // The sensor sheet serves temperature, humidity and flow, so its readings are
    // free text with the unit written in the cell; every meter row is m³.
    for (const id of ["field", "bms", "offset"]) {
      expect(theirs.columns.find((c) => c.id === id)!.type).toBe("text");
      expect(theirs.columns.find((c) => c.id === id)!.unit).toBeUndefined();
    }
    expect(mine.columns.find((c) => c.id === "bms")!.type).toBe("number");
    expect(mine.columns.find((c) => c.id === "offset")!.type).toBe("calculated");

    // Verifying a meter uses no instrument; calibrating a sensor uses a reference.
    expect(sensor.instruments).toBeDefined();
    expect(template.instruments).toBeUndefined();
    expect(html).not.toContain("Instrument");
  });
});
