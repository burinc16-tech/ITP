import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { isDynamicTableSection, parseTemplate, safeParseTemplate } from "@schema";
import rawTemplate from "../../../spec/templates/vav-air-balancing.json";
import { computeCell, computeTotals } from "../lib/grouped-table";
import type { TableGroup } from "../lib/values";

/**
 * Parity between the converted template and the form it came from.
 *
 * The repo's verification standard is "matching the original wins" (CLAUDE.md).
 * The source HTML ships with a real, filled AHU-A-602 report *and* the JavaScript
 * that computed its numbers, so this replays every reading in that file through
 * the app's arithmetic and asserts it agrees with the original form — cell for
 * cell, total for total. If the renderer ever drifts, this fails with the VAV
 * unit that broke.
 *
 * The readings are read from the source file at test time and never copied into
 * the template, which stays blank (Hard Rule #5 / §5.1).
 */

// Resolved from the project root — vitest runs with cwd there, and
// `import.meta.url` is not a file: URL once the source has been transformed.
const SOURCE = resolve(process.cwd(), "spec/VAV_Air_Balancing_Form.html");

interface SourceRow {
  area: string;
  no: number;
  type: string;
  dsize: string;
  design: number | null;
  balanced: number | null;
}
interface SourceGroup {
  sn: number;
  tag: string;
  size: number | string;
  vel: string;
  rem: string;
  rows: SourceRow[];
}

/** The `var GROUPS = [...]` seed data the source form renders itself from. */
function sourceGroups(): SourceGroup[] {
  const html = readFileSync(SOURCE, "utf8");
  const match = /var GROUPS = (\[[\s\S]*?\]);\s*\n\s*var AHU/.exec(html);
  if (!match) throw new Error("could not locate GROUPS in the source form");
  return JSON.parse(match[1]!) as SourceGroup[];
}

// --- the source form's own arithmetic, transcribed verbatim ---------------
// From the <script> block: pctStr() and the recalc() totals loop.

function srcPct(b: number | null, d: number | null): string {
  return b !== null && d !== null && d !== 0 ? Math.round((b / d) * 100) + "%" : "";
}

function srcTotals(rows: SourceRow[]): { des: number; bal: string; pct: string } {
  let sumD = 0;
  let sumB = 0;
  let anyB = false;
  for (const r of rows) {
    if (r.design !== null) sumD += r.design;
    if (r.balanced !== null) {
      sumB += r.balanced;
      anyB = true;
    }
  }
  return {
    des: sumD,
    bal: anyB ? String(sumB) : "",
    pct: anyB && sumD !== 0 ? Math.round((sumB / sumD) * 100) + "%" : "",
  };
}

// --- the template under test ----------------------------------------------

const template = parseTemplate(rawTemplate);
const section = template.sections.find((s) => s.id === "balancing")!;
if (!isDynamicTableSection(section)) throw new Error("expected a table section");

/** The source's group data as the app would store it in a record. */
function asRecordGroup(g: SourceGroup): TableGroup {
  return {
    fields: {
      tag: g.tag,
      size: String(g.size ?? ""),
      velocity: g.vel ?? "",
      remarks: g.rem ?? "",
    },
    rows: g.rows.map((r) => ({
      area: r.area,
      diff_no: String(r.no),
      type: r.type,
      dsize: r.dsize,
      design: r.design === null ? "" : String(r.design),
      balanced: r.balanced === null ? "" : String(r.balanced),
    })),
  };
}

describe("VAV template — schema validation", () => {
  it("parses cleanly against the template schema", () => {
    const result = safeParseTemplate(rawTemplate);
    expect(result.success).toBe(true);
    if (!result.success) console.error(result.error.issues);
  });

  it("declares the identity the register and print footer rely on", () => {
    expect(template.code).toBe("VAB");
    expect(template.rev).toBe("A");
    expect(template.category).toBe("ITR");
    expect(template.scope).toBe("equipment");
    expect(template.page).toEqual({ size: "A4", orientation: "landscape" });
    expect(template.source).toBe("spec/VAV_Air_Balancing_Form.html");
  });
});

describe("VAV template — structural parity with the source form", () => {
  const html = readFileSync(SOURCE, "utf8");

  it("carries every data column the source table has, in order", () => {
    // Source header cells, in the order the paper form prints them.
    const expected = [
      "Equipment Tag",
      "size",
      "Velocity m/s",
      "Service Area",
      "Diffuser No.",
      "Diffuser Type",
      "Diffuser Size",
      "Design Air Flow",
      "Balanced Air Flow",
      "Percentage",
      "Remarks",
    ];
    for (const label of expected) expect(html).toContain(label);

    const group = section.row_group!;
    expect(group.columns.map((c) => c.id)).toEqual([
      "tag",
      "size",
      "velocity",
      "remarks",
    ]);
    expect(section.columns.map((c) => c.id)).toEqual([
      "area",
      "diff_no",
      "type",
      "dsize",
      "design",
      "balanced",
      "pct",
    ]);
  });

  it("uses the same units the source column headers state", () => {
    const byId = new Map(section.columns.map((c) => [c.id, c]));
    expect(byId.get("dsize")!.unit).toBe("mm x mm");
    expect(byId.get("design")!.unit).toBe("CMH");
    expect(byId.get("balanced")!.unit).toBe("CMH");
    expect(byId.get("pct")!.unit).toBe("%");
    expect(section.row_group!.columns.find((c) => c.id === "velocity")!.unit)
      .toBe("m/s");
  });

  it("carries the source form's three sign-off roles in order", () => {
    expect(html).toContain("TESTED BY");
    expect(html).toContain("WITNESS BY");
    const signoff = template.sections.find((s) => s.id === "signoff")!;
    expect("signatures" in signoff && signoff.signatures.map((s) => s.role)).toEqual([
      "Tested by",
      "Witness by",
      "Witness by",
    ]);
  });
});

describe("VAV template — arithmetic parity on the real AHU-A-602 readings", () => {
  const groups = sourceGroups();

  it("reads all 15 VAV units out of the source form", () => {
    expect(groups).toHaveLength(15);
    expect(groups[0]!.tag).toBe("VAV A-602-02");
    expect(groups.reduce((n, g) => n + g.rows.length, 0)).toBe(65);
  });

  it("computes every diffuser percentage exactly as the source form does", () => {
    const pct = section.columns.find((c) => c.id === "pct")!;
    const mismatches: string[] = [];
    for (const g of groups) {
      const record = asRecordGroup(g);
      g.rows.forEach((row, i) => {
        const mine = computeCell(pct, record.rows[i]!);
        const theirs = srcPct(row.balanced, row.design);
        if (mine !== theirs)
          mismatches.push(
            `${g.tag} diffuser ${row.no}: app "${mine}" vs form "${theirs}"`,
          );
      });
    }
    expect(mismatches).toEqual([]);
  });

  it("computes every unit's totals exactly as the source form does", () => {
    const mismatches: string[] = [];
    for (const g of groups) {
      const mine = computeTotals(section, asRecordGroup(g));
      const theirs = srcTotals(g.rows);
      if (mine.design !== String(theirs.des))
        mismatches.push(`${g.tag} design: app "${mine.design}" vs form "${theirs.des}"`);
      if (mine.balanced !== theirs.bal)
        mismatches.push(`${g.tag} balanced: app "${mine.balanced}" vs form "${theirs.bal}"`);
      if (mine.pct !== theirs.pct)
        mismatches.push(`${g.tag} pct: app "${mine.pct}" vs form "${theirs.pct}"`);
    }
    expect(mismatches).toEqual([]);
  });

  it("leaves the un-balanced Phase 2 unit blank rather than showing 0%", () => {
    // VAV-A-602-05 is marked "(Under Phase 2)" — designed, never balanced.
    const phase2 = groups.find((g) => g.tag === "VAV-A-602-05")!;
    expect(phase2.rows.every((r) => r.balanced === null)).toBe(true);
    const totals = computeTotals(section, asRecordGroup(phase2));
    expect(totals.design).toBe("1650");
    expect(totals.balanced).toBe("");
    expect(totals.pct).toBe("");
  });
});
