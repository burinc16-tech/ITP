import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  isDynamicTableSection,
  isSignOffSection,
  parseTemplate,
  type DynamicTableSection,
} from "@schema";
import rawTemplate from "../../../spec/templates/vrv-cu-fcu-test.json";

/**
 * Parity between the converted template and the sheet it came from.
 *
 * The sheet has no arithmetic — every cell is a reading or a label — so parity
 * is structural: a column for every box the grid provides, and a page shape that
 * holds them. The source's DAIKIN readings are read at test time and must not
 * appear in the template (Hard Rule #5 / §5.1).
 */

const SOURCE = resolve(process.cwd(), "spec/VRV_CU_FCU_Test_Form.html");
const template = parseTemplate(rawTemplate);

const units = template.sections.find((s) => s.id === "units")!;
if (!isDynamicTableSection(units)) throw new Error("units is not a dynamic table");
const table: DynamicTableSection = units;

describe("VRV CU / FCU Test Form — parity with the source sheet", () => {
  it("is a landscape ACMV ITR scoped to the room, not one unit", () => {
    expect(template.code).toBe("VRV");
    expect(template.discipline).toBe("ACMV");
    expect(template.category).toBe("ITR");
    // The sheet lists a CU and its FCU together under one Network Room.
    expect(template.scope).toBe("location");
    expect(template.page).toEqual({ size: "A4", orientation: "landscape" });
  });

  it("matches the source's six-row grid", () => {
    const html = readFileSync(SOURCE, "utf8");
    // Each body row of the source grid opens with an Item cell.
    const bodyRows = [...html.matchAll(/<td class="c-item">/g)].length;
    expect(bodyRows).toBe(6);
    expect(table.min_rows).toBe(6);
    expect(table.auto_number).toBe(true);
    expect(table.number_label).toBe("Item");
  });

  it("gives every box on the grid a column", () => {
    expect(table.columns.map((c) => c.id)).toEqual([
      "brand",
      "equip_no",
      "cu_model",
      "fcu_model",
      "press_low",
      "press_high",
      "current_l1",
      "current_l2",
      "current_l3",
      "voltage",
      "power",
      "remarks",
    ]);
  });

  it("splits the stacked L1/L2/L3 current cell into three columns", () => {
    const html = readFileSync(SOURCE, "utf8");
    // The three-phase CU row stacks three labelled inputs in one cell; the
    // single-phase FCU row carries one.
    expect(html).toContain("cur-multi");
    expect(html).toContain("cur-single");
    for (const id of ["current_l1", "current_l2", "current_l3"]) {
      const column = table.columns.find((c) => c.id === id)!;
      expect(column.type).toBe("number");
      expect(column.unit).toBe("A");
    }
  });

  it("keeps the CU pressures as text, since an FCU row has none", () => {
    const html = readFileSync(SOURCE, "utf8");
    expect(html).toContain('class="cell-input ta-center" value="-"');
    for (const id of ["press_low", "press_high"]) {
      const column = table.columns.find((c) => c.id === id)!;
      expect(column.type).toBe("text");
      expect(column.unit).toBe("psi");
    }
  });

  it("carries the units the source heads its columns with", () => {
    const unitOf = (id: string) => table.columns.find((c) => c.id === id)?.unit;
    expect(unitOf("voltage")).toBe("V");
    // The source types the unit inline ("3.23kw"); the column carries it here.
    expect(unitOf("power")).toBe("kW");
  });

  it("carries none of the sheet's project data", () => {
    const html = readFileSync(SOURCE, "utf8");
    // Compared against the template's *values*, with the `_note` annotations
    // stripped: those are documentation for whoever reads the file next and may
    // legitimately quote the source sheet. Only what renders counts.
    const json = JSON.stringify(rawTemplate, (key, value) =>
      key === "_note" || key === "_status" ? undefined : value,
    );
    for (const value of [
      "DAIKIN",
      "DX-CU-A-NR-201",
      "RXUQ6BYMG",
      "FXMQ140PAVE",
      "Apple AMK2",
      "19/03/2026",
    ]) {
      expect(html).toContain(value);
      expect(json).not.toContain(value);
    }
  });
});

describe("VRV CU / FCU Test Form — page layout", () => {
  it("prints the grid on one page and the acknowledgement on the footer page", () => {
    // Measured with all six rows filled: the grid is 268.8mm inside 269mm of
    // printable width, and 143.7mm of a 158mm body — roughly one spare row.
    // An in-flow sign_off measured 82.1mm and put the page 82.4mm over.
    expect(template.sections).toHaveLength(1);
    expect(template.sections.some((s) => isSignOffSection(s))).toBe(false);
    expect(template.footer).toBeDefined();
    expect(template.footer!.title).toBe("Acknowledgement");
  });

  it("acknowledges tested / witnessed / witnessed, as the sheet heads it", () => {
    expect(template.footer!.signatures.map((s) => s.role)).toEqual([
      "Tested By",
      "Witnessed By",
      "Witnessed By",
    ]);
    expect(template.footer!.signatures.map((s) => s.stage)).toEqual([
      "contractor",
      "witness",
      "client",
    ]);
  });
});
