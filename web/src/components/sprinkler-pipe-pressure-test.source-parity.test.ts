import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { isSignOffSection, isStandardSection, parseTemplate } from "@schema";
import rawTemplate from "../../../spec/templates/sprinkler-pipe-pressure-test.json";
import hoseReelRaw from "../../../spec/templates/hose-reel-pipe-pressure-test.json";

/**
 * Parity between the converted template and the sheet it came from — and with
 * its siblings.
 *
 * This is the fourth issue of the same four-part pressure test report:
 * `plumbing-pressure-test` (PPT), `acmv-pipe-pressure-test` (APT) and
 * `hose-reel-pipe-pressure-test` (HRP). The hose reel sheet is the closest
 * sibling — same discipline, byte-for-byte the same fields — so this pins the
 * pair together. If someone revises one form and not the other, the mismatch
 * surfaces here rather than on a signed PDF.
 */

const SOURCE = resolve(process.cwd(), "spec/Sprinkler_Pipe_Pressure_Test.html");
const template = parseTemplate(rawTemplate);
const hoseReel = parseTemplate(hoseReelRaw);

describe("Sprinkler Pipe Pressure Test — parity with the source sheet", () => {
  it("is a portrait fire protection ITR scoped to the line, not one item of equipment", () => {
    expect(template.code).toBe("SPT");
    expect(template.discipline).toBe("Fire Protection");
    expect(template.category).toBe("ITR");
    expect(template.scope).toBe("location");
    expect(template.page).toEqual({ size: "A4", orientation: "portrait" });
  });

  it("carries the sheet's four parts in order", () => {
    expect(template.sections.map((s) => s.no)).toEqual(["1", "2", "3"]);
    expect(template.footer?.no).toBe("4");
    const html = readFileSync(SOURCE, "utf8");
    for (const part of [
      "PIPING – LINE REFERENCE DATA",
      "PRESSURE GAUGE &amp; CHART RECORDER DATA",
      "TEST DATA",
      "TEST RESULT",
    ]) {
      expect(html).toContain(part);
    }
  });

  it("is the sprinkler sheet, not the hose reel one", () => {
    const html = readFileSync(SOURCE, "utf8");
    expect(html).toContain("SPRINKLER PIPE PRESSURE TEST");
    expect(template.title).toBe("Sprinkler Pipe Pressure Test");
    expect(template.code).not.toBe(hoseReel.code);
  });

  it("carries no project data from the sheet", () => {
    const html = readFileSync(SOURCE, "utf8");
    const json = JSON.stringify(rawTemplate, (key, value) =>
      key === "_note" || key === "_status" ? undefined : value,
    );
    // The sheet arrived filled in from a live test; none of it belongs in the
    // template, which ships blank.
    for (const value of [
      "APPLE-FP-26",
      "AMK3 Foyer and Café Mac",
      "ASMS24/2832",
      "KEN-24-0065-P4-FP-202",
    ]) {
      expect(html).toContain(value);
      expect(json).not.toContain(value);
    }
  });
});

describe("Sprinkler Pipe Pressure Test — kept in step with the hose reel sibling", () => {
  it("asks the same questions in Parts 1, 2 and 3", () => {
    const mineLine = template.sections.find((s) => s.id === "line_reference")!;
    const theirsLine = hoseReel.sections.find((s) => s.id === "line_reference")!;
    expect("fields" in mineLine && mineLine.fields.map((f) => f.id)).toEqual(
      "fields" in theirsLine && theirsLine.fields.map((f) => f.id),
    );

    for (const id of ["gauge_data", "test_data"]) {
      const mine = template.sections.find((s) => s.id === id)!;
      const theirs = hoseReel.sections.find((s) => s.id === id)!;
      if (!isStandardSection(mine) || !isStandardSection(theirs)) {
        throw new Error(`${id} is not a standard section on both`);
      }
      expect(mine.rows.map((r) => r.id)).toEqual(theirs.rows.map((r) => r.id));
      expect(mine.rows.map((r) => r.type)).toEqual(theirs.rows.map((r) => r.type));
      expect(mine.rows.map((r) => r.description)).toEqual(
        theirs.rows.map((r) => r.description),
      );
    }
  });

  it("differs only in code, title and source — the discipline is shared", () => {
    expect(template.code).not.toBe(hoseReel.code);
    expect(template.title).not.toBe(hoseReel.title);
    // Both are fire protection: unlike the PPT / APT pair, the discipline matches.
    expect(template.discipline).toBe(hoseReel.discipline);
    // Everything that governs how a record is filled in stays the same.
    expect(template.category).toBe(hoseReel.category);
    expect(template.scope).toBe(hoseReel.scope);
    expect(template.page).toEqual(hoseReel.page);
    expect(template.header.fields.map((f) => f.id)).toEqual(
      hoseReel.header.fields.map((f) => f.id),
    );
    expect(template.footer!.signatures.map((s) => s.stage)).toEqual(
      hoseReel.footer!.signatures.map((s) => s.stage),
    );
    expect(template.footer!.title).toBe(hoseReel.footer!.title);
  });
});

describe("Sprinkler Pipe Pressure Test — page layout", () => {
  it("prints Parts 1-2, then Part 3, then the sign-off", () => {
    // Same rows as HRP and APT, so the same measured heights: Parts 1-2 are
    // 213.6mm of a 245mm body, Part 3 is 214.6mm, Part 4 is 106.8mm on the
    // footer's page. Part 3 and Part 4 together measured 321.4mm — 76mm over —
    // hence the footer and the break before Part 3.
    const breaks = template.sections.map(
      (s) => (s as { page_break_before?: boolean }).page_break_before === true,
    );
    expect(breaks).toEqual([false, false, true]);
    expect(template.sections.some((s) => isSignOffSection(s))).toBe(false);
    expect(template.footer).toBeDefined();
  });
});
