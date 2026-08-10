import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { isDynamicTableSection, parseTemplate } from "@schema";
import rawTemplate from "../../../spec/templates/chwfcu-air-balancing.json";
import { computeCell, computeFlatTotals } from "../lib/grouped-table";
import type { TableRow } from "../lib/values";

/**
 * Parity between the converted template and the form it came from.
 *
 * The repo's verification standard is "matching the original wins" (CLAUDE.md).
 * The source HTML ships with the real CHWFCU-A-NR-601 readings *and* the
 * JavaScript that computed its numbers, so this replays every reading through
 * the app's arithmetic and asserts it agrees with the original form — cell for
 * cell and on the Total Air Flow line.
 *
 * The readings are read from the source file at test time and never copied into
 * the template, which stays blank (Hard Rule #5 / §5.1).
 */

const SOURCE = resolve(process.cwd(), "spec/CHWFCU_Air_Balancing_Form.html");

interface SourceRow {
  item: number;
  diff: number;
  face: string;
  int: string;
  des: number;
  fL: number;
  fM: number;
  fH: number;
  grill: string;
  rem: string;
}

/** The `var ROWS = [...]` seed data the source form renders itself from. */
function sourceRows(): SourceRow[] {
  const html = readFileSync(SOURCE, "utf8");
  const match = /var ROWS = (\[[\s\S]*?\]);/.exec(html);
  if (!match) throw new Error("could not locate ROWS in the source form");
  // The seed is JS object literal syntax; quote the bare keys to parse as JSON.
  const json = match[1]!.replace(
    /([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g,
    '$1"$2":',
  );
  return JSON.parse(json) as SourceRow[];
}

// --- the source form's own arithmetic, transcribed verbatim ---------------
// From the <script> block: pct() and the recalc() totals loop.

function srcPct(f: number | null, d: number | null): string {
  return f !== null && d !== null && d !== 0 ? Math.round((f / d) * 100) + "%" : "-";
}

function srcTotals(rows: SourceRow[]): { des: number; high: number; pct: string } {
  let sumDes = 0;
  let sumHigh = 0;
  for (const r of rows) {
    sumDes += r.des;
    sumHigh += r.fH;
  }
  return {
    des: sumDes,
    high: sumHigh,
    pct: sumDes !== 0 ? Math.round((sumHigh / sumDes) * 100) + "%" : "-",
  };
}

const template = parseTemplate(rawTemplate);
const section = template.sections.find((s) => s.id === "balancing")!;
if (!isDynamicTableSection(section)) throw new Error("expected a table section");

/** One source row as the record stores it, keyed by template column ids. */
function asTableRow(r: SourceRow): TableRow {
  return {
    diff_no: String(r.diff),
    face_size: r.face,
    internal_size: r.int,
    design: String(r.des),
    final_l: String(r.fL),
    final_m: String(r.fM),
    final_h: String(r.fH),
    grill_type: r.grill,
    remark: r.rem,
  };
}

describe("CHW FCU Air Balancing — parity with the source form", () => {
  const rows = sourceRows();

  it("finds the original readings in the source file", () => {
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.des).toBe(1120);
  });

  it("reproduces every percentage cell the original form computed", () => {
    for (const r of rows) {
      const row = asTableRow(r);
      for (const [colId, final] of [
        ["pct_l", r.fL],
        ["pct_m", r.fM],
        ["pct_h", r.fH],
      ] as const) {
        const col = section.columns.find((c) => c.id === colId)!;
        const expected = srcPct(final, r.des);
        // The source renders "-" for an uncomputable cell; the app leaves it blank.
        expect(computeCell(col, row)).toBe(expected === "-" ? "" : expected);
      }
    }
  });

  it("reproduces the original form's Total Air Flow line", () => {
    const totals = computeFlatTotals(section, rows.map(asTableRow));
    const src = srcTotals(rows);
    expect(totals.design).toBe(String(src.des));
    expect(totals.final_h).toBe(String(src.high));
    expect(totals.pct_h).toBe(src.pct);
  });
});
