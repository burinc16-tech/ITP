import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { isSignOffSection, isStandardSection, parseTemplate } from "@schema";
import rawTemplate from "../../../spec/templates/hose-reel-pipe-pressure-test.json";
import plumbingRaw from "../../../spec/templates/plumbing-pressure-test.json";

/**
 * Parity between the converted template and the sheet it came from — and with
 * its siblings.
 *
 * This is the same four-part pressure test report as `plumbing-pressure-test`
 * (PPT) and `acmv-pipe-pressure-test` (APT), issued for fire protection hose
 * reel pipework. The three are deliberate near-duplicates, like the CHW and DX
 * air balancing templates, so this pins the parts that must stay identical and
 * the handful that must differ. If someone revises one form and not the others,
 * the mismatch surfaces here rather than on a signed PDF.
 */

const SOURCE = resolve(process.cwd(), "spec/Hose_Reel_Pipe_Pressure_Test.html");
const template = parseTemplate(rawTemplate);
const plumbing = parseTemplate(plumbingRaw);

describe("Hose Reel Pipe Pressure Test — parity with the source sheet", () => {
  it("is a portrait fire protection ITR scoped to the line, not one item of equipment", () => {
    expect(template.code).toBe("HRP");
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
      "PIPING &#8211; LINE REFERENCE DATA",
      "PRESSURE GAUGE &amp; CHART RECORDER DATA",
      "TEST DATA",
      "TEST RESULT",
    ]) {
      expect(html).toContain(part);
    }
  });

  it("keeps the unlabelled note box beside Line No, as PPT does", () => {
    const line = template.sections.find((s) => s.id === "line_reference")!;
    const ids = "fields" in line ? line.fields.map((f) => f.id) : [];
    expect(ids).toEqual([
      "pid_no",
      "pid_rev",
      "dwg_no",
      "dwg_rev",
      "line_no",
      "line_note",
    ]);
  });

  it("carries no project data from the sheet", () => {
    const html = readFileSync(SOURCE, "utf8");
    const json = JSON.stringify(rawTemplate, (key, value) =>
      key === "_note" || key === "_status" ? undefined : value,
    );
    // The sheet arrived filled in from a live test; none of it belongs in the
    // template, which ships blank.
    for (const value of [
      "APPLE-FP-19",
      "AMK2 Roof Staircase 1 Dry Riser",
      "ASMS24/2413",
      "0~300 psi",
    ]) {
      expect(html).toContain(value);
      expect(json).not.toContain(value);
    }
  });
});

describe("Hose Reel Pipe Pressure Test — kept in step with the plumbing sibling", () => {
  it("asks the same questions in Parts 1, 2 and 3", () => {
    const mineLine = template.sections.find((s) => s.id === "line_reference")!;
    const theirsLine = plumbing.sections.find((s) => s.id === "line_reference")!;
    expect("fields" in mineLine && mineLine.fields.map((f) => f.id)).toEqual(
      "fields" in theirsLine && theirsLine.fields.map((f) => f.id),
    );

    for (const id of ["gauge_data", "test_data"]) {
      const mine = template.sections.find((s) => s.id === id)!;
      const theirs = plumbing.sections.find((s) => s.id === id)!;
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

  it("differs only in code, title, discipline, source and pagination", () => {
    expect(template.code).not.toBe(plumbing.code);
    expect(template.discipline).not.toBe(plumbing.discipline);
    // Everything that governs how a record is filled in stays the same.
    expect(template.category).toBe(plumbing.category);
    expect(template.scope).toBe(plumbing.scope);
    expect(template.page).toEqual(plumbing.page);
    expect(template.header.fields.map((f) => f.id)).toEqual(
      plumbing.header.fields.map((f) => f.id),
    );
    expect(template.footer!.signatures.map((s) => s.stage)).toEqual(
      plumbing.footer!.signatures.map((s) => s.stage),
    );
    expect(template.footer!.title).toBe(plumbing.footer!.title);
  });
});

describe("Hose Reel Pipe Pressure Test — page layout", () => {
  it("prints Parts 1-2, then Part 3, then the sign-off", () => {
    // Same rows as APT, so the same measured heights: Parts 1-2 are 213.6mm of
    // a 245mm body, Part 3 is 214.6mm, Part 4 is 106.8mm on the footer's page.
    // Part 3 and Part 4 together measured 321.4mm — 76mm over — hence the
    // footer and the break before Part 3.
    const breaks = template.sections.map(
      (s) => (s as { page_break_before?: boolean }).page_break_before === true,
    );
    expect(breaks).toEqual([false, false, true]);
    expect(template.sections.some((s) => isSignOffSection(s))).toBe(false);
    expect(template.footer).toBeDefined();
  });
});
