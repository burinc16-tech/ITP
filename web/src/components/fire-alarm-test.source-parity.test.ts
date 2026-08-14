import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { isDynamicTableSection, isSignOffSection, parseTemplate } from "@schema";
import rawTemplate from "../../../spec/templates/fire-alarm-test.json";

/**
 * Parity between the converted template and the sheet it came from.
 *
 * The source is a device-by-device test table under a three-field project band,
 * closing on a three-row sign-off. This asserts the table prints the paper's
 * seven columns and no serial of its own, that the two Yes/No columns carry the
 * three answers the sheet's dropdowns actually offer, and that the project and
 * test area the file was saved with stayed out of the template.
 */

const SOURCE = resolve(process.cwd(), "spec/Fire_Alarm_Test_Form.html");
const template = parseTemplate(rawTemplate);

const devices = template.sections.find((s) => s.id === "devices")!;
if (!isDynamicTableSection(devices))
  throw new Error("devices is not a dynamic table section");

/** The column headings of the source table, in order. */
function sourceHeadings(): string[] {
  const html = readFileSync(SOURCE, "utf8");
  const thead = html.slice(html.indexOf("<thead>"), html.indexOf("</thead>"));
  return [...thead.matchAll(/<th[^>]*>([^<]+)<\/th>/g)].map((m) => m[1]!.trim());
}

describe("Fire Alarm System Test — parity with the source sheet", () => {
  it("is a portrait Electrical ITR scoped to a location", () => {
    expect(template.code).toBe("FAT");
    expect(template.title).toBe("Fire Alarm System Test");
    expect(template.discipline).toBe("Electrical");
    expect(template.category).toBe("ITR");
    expect(template.scope).toBe("location");
    expect(template.page).toEqual({ size: "A4", orientation: "portrait" });
  });

  it("carries the sheet's three project fields as the record header", () => {
    expect(template.header.fields.map((f) => f.id)).toEqual([
      "project",
      "test_area",
      "test_date",
    ]);
    const area = template.header.fields.find((f) => f.id === "test_area")!;
    expect(area.source).toBe("equipment.location");
    expect(area.required).toBe(true);
  });

  it("prints the paper's seven columns, in its order", () => {
    // The source heads Device Operation and Labeling over a shared "Yes/No"
    // sub-row; flat columns drop the spanning cell, so the sub-headings are the
    // two entries the template does not reproduce.
    const headings = sourceHeadings();
    expect(headings).toEqual([
      "Zone Number",
      "Location",
      "Device",
      "Function",
      "Device Operation",
      "Labeling",
      "Remark",
      "Yes/No",
      "Yes/No",
    ]);
    expect(devices.columns.map((c) => c.label)).toEqual(headings.slice(0, 7));
  });

  it("adds no serial column ahead of the sheet's Zone Number", () => {
    expect(devices.auto_number).toBeUndefined();
    expect(devices.columns[0]!.id).toBe("zone");
    expect(devices.columns[0]!.type).toBe("text");
  });

  it("answers Yes / No / N/A on both tick columns, as the dropdowns do", () => {
    // The headings promise Yes/No; the sheet's own <select> lists three.
    expect(readFileSync(SOURCE, "utf8")).toContain("<option>N/A</option>");
    for (const id of ["operation", "labeling"]) {
      const col = devices.columns.find((c) => c.id === id)!;
      expect(col.type).toBe("status");
      expect(col.states?.map((s) => s.label)).toEqual(["Yes", "No", "N/A"]);
      // A "No" answer must be derivable as an outstanding item (SPEC §6).
      expect(col.states?.map((s) => s.outcome)).toEqual(["pass", "fail", "na"]);
    }
  });

  it("seeds fewer rows than the paper rules, and adds the rest on site", () => {
    // The source injects seventeen blank rows; blank rows are space to write,
    // not template data, so a six-device record prints six rows.
    expect(readFileSync(SOURCE, "utf8")).toContain("i<17");
    expect(devices.min_rows).toBe(5);
    expect(devices.prefilled_rows).toBeUndefined();
  });

  it("carries none of the sheet's project data", () => {
    const json = JSON.stringify(rawTemplate);
    const html = readFileSync(SOURCE, "utf8");
    for (const value of ["APPLE AMK1 Material Lab 2", "Townes Lab 2"]) {
      expect(html).toContain(value);
      expect(json).not.toContain(value);
    }
  });
});

describe("Fire Alarm System Test — page layout", () => {
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

  it("keeps the device table whole by giving the sign-off its own sheet", () => {
    expect(pages()).toEqual([["devices"], ["sign_off"]]);
    // Measured on the live build against a 232.2mm page body: title and header
    // band 54.7mm, table heading row 14.4mm, a filled device row 14.4mm (19.5mm
    // when the location runs long) — about ten tested devices on page 1. The
    // sign-off grid is 94.1mm, which would have capped the table at about four.
    // A blank form still prints its seventeen rows: an unused row is 4.2mm.
  });

  it("signs the sheet's three rows, and heads the lower two alike", () => {
    expect(template.footer).toBeUndefined();
    const signOff = template.sections.at(-1)!;
    expect(isSignOffSection(signOff)).toBe(true);
    if (!isSignOffSection(signOff)) return;
    expect(signOff.signatures.map((s) => s.role)).toEqual([
      "Test By",
      "Witness By",
      "Witness By",
    ]);
    expect(signOff.signatures.map((s) => s.stage)).toEqual([
      "contractor",
      "witness",
      "client",
    ]);
    expect(signOff.signatures[0]!.company_default).toBe("Kenyon Pte Ltd");
  });
});
