import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { isDynamicTableSection, isSignOffSection, parseTemplate } from "@schema";
import rawTemplate from "../../../spec/templates/ductwork-air-leakage-test.json";
import { computeCell, computeFlatTotals } from "../lib/grouped-table";
import type { TableRow } from "../lib/values";

/**
 * Parity between the converted template and the form it came from.
 *
 * The repo's verification standard is "matching the original wins" (CLAUDE.md).
 * The source HTML ships filled with a real AMK3 duct leakage test, so this
 * replays its two duct sections through the app's arithmetic and asserts the
 * computed Area and the Total line agree with the numbers on the original form.
 *
 * The readings are read from the source file at test time and never copied into
 * the template, which stays blank (Hard Rule #5 / §5.1).
 */

const SOURCE = resolve(process.cwd(), "spec/Ductwork_Air_Leakage_Test.html");

const template = parseTemplate(rawTemplate);
const section = template.sections.find((s) => s.id === "duct_sections")!;

interface SourceSection {
  letter: string;
  periphery: string;
  length: string;
  area: string;
}

/**
 * The filled duct-section rows of the source form. Each is a `<tr>` of a letter
 * cell followed by four `<input value="...">` cells: size, periphery, length,
 * area. Blank rows (C and D on the source) are skipped.
 */
function sourceSections(): SourceSection[] {
  const html = readFileSync(SOURCE, "utf8");
  const rows = html.matchAll(
    /<td>([A-D])<\/td>((?:\s*<td><input[^>]*><\/td>){4})/g,
  );
  const out: SourceSection[] = [];
  for (const row of rows) {
    const values = [...row[2]!.matchAll(/value="([^"]*)"/g)].map((m) => m[1]!);
    const [, periphery, length, area] = values;
    if (!periphery || !length) continue;
    out.push({ letter: row[1]!, periphery, length, area: area ?? "" });
  }
  return out;
}

/** The `Total >>>` figure the source form carries, e.g. "103.545 (M2)". */
function sourceTotal(): string {
  const html = readFileSync(SOURCE, "utf8");
  const match = /Total &gt;&gt;&gt;[\s\S]*?value="([^"]*)"/.exec(html);
  if (!match) throw new Error("could not locate the Total row in the source form");
  return match[1]!;
}

describe("Ductwork Air Leakage Test — parity with the source form", () => {
  it("reads the source form's two filled duct sections", () => {
    const rows = sourceSections();
    expect(rows.map((r) => r.letter)).toEqual(["A", "B"]);
  });

  it("computes each section's Area to the same value as the source form", () => {
    if (!isDynamicTableSection(section)) throw new Error("not a dynamic table");
    const column = section.columns.find((c) => c.id === "area")!;
    for (const row of sourceSections()) {
      const computed = computeCell(column, {
        periphery: row.periphery,
        length: row.length,
      } as TableRow);
      // Compared as numbers, not strings: the source form prints whatever JS
      // number-to-string gives (`51.035` but `52.51`), which is an artifact of
      // its `recalc()`, not a chosen format. The app pads every Area cell to the
      // column's 3 dp so the printed column aligns — same number either way.
      expect(Number(computed.replace(/M2$/, ""))).toBeCloseTo(Number(row.area), 6);
    }
  });

  it("formats every Area cell to a consistent 3 dp with its unit", () => {
    if (!isDynamicTableSection(section)) throw new Error("not a dynamic table");
    const column = section.columns.find((c) => c.id === "area")!;
    expect(column.decimals).toBe(3);
    const computed = computeCell(column, {
      periphery: "5.9",
      length: "8.9",
    } as TableRow);
    expect(computed).toBe("52.510M2");
  });

  it("sums the calculated Area column into the Total line", () => {
    if (!isDynamicTableSection(section)) throw new Error("not a dynamic table");
    const rows = sourceSections().map(
      (r) => ({ periphery: r.periphery, length: r.length }) as TableRow,
    );
    const totals = computeFlatTotals(section, rows);
    expect(totals.area).toBe(sourceTotal());
  });

  it("totals blank when nothing is filled, never a misleading zero", () => {
    if (!isDynamicTableSection(section)) throw new Error("not a dynamic table");
    const totals = computeFlatTotals(section, [{}, {}, {}, {}] as TableRow[]);
    expect(totals.area).toBe("");
  });
});

describe("Ductwork Air Leakage Test — page layout", () => {
  it("prints as two pages: the test on one, instruments and sign-off on the other", () => {
    // `paginate` starts a page at each `page_break_before`; the sole break is on
    // the instruments block, so everything before it shares page 1.
    const breaks = template.sections.map(
      (s) => (s as { page_break_before?: boolean }).page_break_before === true,
    );
    expect(breaks).toEqual([false, false, false, true, false]);
    expect(template.sections.map((s) => s.id)).toEqual([
      "primary_data",
      "duct_sections",
      "measured_data",
      "instruments",
      "sign_off",
    ]);
  });

  it("signs off in the section flow, so the footer cannot claim its own page", () => {
    expect(template.footer).toBeUndefined();
    const signOff = template.sections.find((s) => s.id === "sign_off")!;
    expect(isSignOffSection(signOff)).toBe(true);
    if (!isSignOffSection(signOff)) return;
    expect(signOff.page_break_before).toBeUndefined();
    expect(signOff.signatures.map((s) => s.stage)).toEqual([
      "contractor",
      "witness",
      "client",
    ]);
  });
});
