import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { isSignOffSection, isStandardSection, parseTemplate } from "@schema";
import rawTemplate from "../../../spec/templates/acmv-pipe-pressure-test.json";
import plumbingRaw from "../../../spec/templates/plumbing-pressure-test.json";

/**
 * Parity between the converted template and the sheet it came from — and with
 * its sibling.
 *
 * This is the same four-part pressure test report as `plumbing-pressure-test`
 * (PPT), issued for ACMV pipework. The pair are deliberate near-duplicates, like
 * the CHW and DX air balancing templates, so this pins the parts that must stay
 * identical and the handful that must differ. If someone revises one form and
 * not the other, the mismatch surfaces here rather than on a signed PDF.
 */

const SOURCE = resolve(process.cwd(), "spec/ACMV_Pipe_Pressure_Test.html");
const template = parseTemplate(rawTemplate);
const plumbing = parseTemplate(plumbingRaw);

describe("ACMV Pipe Pressure Test — parity with the source sheet", () => {
  it("is a portrait ACMV ITR scoped to the line, not one item of equipment", () => {
    expect(template.code).toBe("APT");
    expect(template.discipline).toBe("ACMV");
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

  it("drops PPT's unlabelled note box, which this sheet does not have", () => {
    const line = template.sections.find((s) => s.id === "line_reference")!;
    const ids = "fields" in line ? line.fields.map((f) => f.id) : [];
    expect(ids).toEqual(["pid_no", "pid_rev", "dwg_no", "dwg_rev", "line_no"]);
    expect(ids).not.toContain("line_note");
  });

  it("carries no project data from the sheet", () => {
    const html = readFileSync(SOURCE, "utf8");
    const json = JSON.stringify(rawTemplate, (key, value) =>
      key === "_note" || key === "_status" ? undefined : value,
    );
    // The sheet ships blank, with example values only as placeholders.
    for (const value of ["APPLE-ACMV-91", "0 to 300 psi", "152 psi"]) {
      expect(html).toContain(value);
      expect(json).not.toContain(value);
    }
  });
});

describe("ACMV Pipe Pressure Test — kept in step with the plumbing sibling", () => {
  it("asks the same questions in Parts 2 and 3", () => {
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
  });
});

describe("ACMV Pipe Pressure Test — page layout", () => {
  it("prints Parts 1-2, then Part 3, then the sign-off", () => {
    // Measured with every field filled: Parts 1-2 are 213.6mm of a 245mm body,
    // Part 3 is 214.6mm, Part 4 is 106.8mm on the footer's page. Part 3 and
    // Part 4 together measured 321.4mm — 76mm over — hence the footer.
    const breaks = template.sections.map(
      (s) => (s as { page_break_before?: boolean }).page_break_before === true,
    );
    expect(breaks).toEqual([false, false, true]);
    expect(template.sections.some((s) => isSignOffSection(s))).toBe(false);
    expect(template.footer).toBeDefined();
  });
});
