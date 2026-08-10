import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  isFieldGroupSection,
  isSignOffSection,
  isStandardSection,
  parseTemplate,
  type StandardSection,
} from "@schema";
import rawTemplate from "../../../spec/templates/chemical-flush-checklist.json";

/**
 * Parity between the converted template and the sheet it came from.
 *
 * The source is a single A4 portrait sheet: a title, a test-section line, one
 * two-column table (item | Comments) whose bold rows head four blocks, each with
 * a "+ row" button, then a combined remarks/instruments box and three sign-off
 * rows. Its blank trailing rows are places to add items, not items.
 *
 * The conversion diverges in two places, both deliberate and both pinned here as
 * *additions*: a Yes / No / NA column the paper does not have (SPEC §6, so a
 * "No" is derivable as an outstanding item), and item numbers the paper does not
 * carry (the renderer always prints a serial column; empty, it reads as a fault).
 * Everything else — every worded item, its order, its block, and its Comments
 * cell — is the sheet's, so a later edit cannot quietly drop the paper's half.
 *
 * The page-layout expectations at the bottom are measured, not guessed; see the
 * print-parity notes in the template.
 */

const SOURCE = resolve(process.cwd(), "spec/Chemical_Flush_Checklist.html");
const template = parseTemplate(rawTemplate);

/** The single checklist section. */
function checklist(): StandardSection {
  const section = template.sections.find((s) => s.id === "checklist");
  if (!section || !isStandardSection(section)) {
    throw new Error("checklist is not a standard section");
  }
  return section;
}

/** The three tick states, identical on every row and every added row. */
const STATES = [
  { value: "yes", label: "Yes", outcome: "pass" },
  { value: "no", label: "No", outcome: "fail" },
  { value: "na", label: "NA", outcome: "na" },
];

describe("Chilled Water System Flushing Record — parity with the source sheet", () => {
  it("is a portrait ACMV ITR scoped to a section of the system", () => {
    expect(template.code).toBe("CWF");
    expect(template.title).toBe("Chilled Water System Flushing Record");
    expect(template.discipline).toBe("ACMV");
    expect(template.category).toBe("ITR");
    // A flush covers a portion of pipework, not one tagged item of equipment.
    expect(template.scope).toBe("location");
    expect(template.page).toEqual({ size: "A4", orientation: "portrait" });
  });

  it("keeps the sheet's blocks, in the sheet's order, in one table", () => {
    const html = readFileSync(SOURCE, "utf8");
    for (const heading of [
      "Chilled Water System Flushing Record",
      "TEST SECTION (Attach Marked Up Schematic and Layout Plan Drawings)",
      "Pre-Requisite Requirements:",
      "Preparation:",
      "Flushing Procedure:",
      "Post-Flushing:",
      "REMARKS / INSTRUMENTS USED.",
    ]) {
      expect(html).toContain(heading);
    }
    expect(template.sections.map((s) => s.id)).toEqual([
      "checklist",
      "remarks",
      "sign_off",
    ]);
    // The sheet's bold block rows are `group` headings inside one table, as on
    // the paper — not four sections, which would print four titles and four
    // repeated column headers the paper does not have.
    const groups = [...new Set(checklist().rows.map((r) => r.group))];
    expect(groups).toEqual([
      "Pre-Requisite Requirements",
      "Preparation",
      "Flushing Procedure",
      "Post-Flushing",
    ]);
  });

  it("asks every worded item of the sheet, verbatim and in order", () => {
    const html = readFileSync(SOURCE, "utf8");
    const wording = [
      "Hydrostatic Test Complete",
      "Sufficient Permanent or Temporary Water &amp; Power available",
      "Sufficient Drainage available for Balanced Flush.",
      "Written Approval to Discharge Chemicals to Public Drain.",
      "Confirm the following Components are installed:",
      "a) Flushing Loops at Equipment/Risers.",
      "b) Line Size Drain Points up to 50mm and above.",
      "c) Dosing Pot (For introduction of chemical).",
      "d) System or Temporary Pumps able to provide Flushing Velocity",
      "e) Specify Chemical Used for Cleaning &amp; Quantity / Concentration",
      "System left Filled with Water and Dosed with Inhibitor or Biocide.",
      "Flushing Bypasses Removed or Isolated and Drain Points Plugged.",
      "Verified PH before drain.",
      "Strainer has been cleaned after flushing completed.",
    ];
    for (const text of wording) expect(html).toContain(text);
    expect(checklist().rows.map((r) => r.description)).toEqual(
      wording.map((t) => t.replace(/&amp;/g, "&")),
    );
  });

  it("adds a Yes / No / NA column, keeping the sheet's Comments cell beside it", () => {
    const html = readFileSync(SOURCE, "utf8");
    // The source records a comment and nothing else: two columns, the second
    // headed Comments, and no tick words anywhere in its markup.
    expect(html).toContain('<td class="r">Comments</td>');
    for (const tick of ["Yes", "No", "N/A", "N.A.", "NA", "Pass", "Fail"]) {
      expect(html).not.toContain(`>${tick}<`);
    }
    const section = checklist();
    expect(section.columns).toEqual({
      result: { label: "Yes / No / NA" },
      remarks: { label: "Comments" },
    });
    for (const row of section.rows) {
      expect(row.type).toBe("status");
      expect(row.states).toEqual(STATES);
      // The paper's Comments cell, not dropped to make room for the tick.
      expect(row.remarks).toBe(true);
    }
  });

  it("maps the tick states so a No becomes an outstanding item", () => {
    // SPEC §6: only `fail` is outstanding — NA and a blank answer are not.
    expect(STATES.map((s) => s.outcome)).toEqual(["pass", "fail", "na"]);
    expect(STATES.find((s) => s.outcome === "fail")!.label).toBe("No");
  });

  it("numbers the items 1..n, which the sheet does not", () => {
    // `StandardTable` always prints a serial column; empty, it rules a blank
    // column down a signed document.
    const html = readFileSync(SOURCE, "utf8");
    expect(html).not.toMatch(/<td[^>]*>\s*1\s*<\/td>/);
    const rows = checklist().rows;
    expect(rows.map((r) => r.no)).toEqual(
      rows.map((_, i) => String(i + 1)),
    );
  });

  it("turns every blank row and every + row button into an added row", () => {
    const html = readFileSync(SOURCE, "utf8");
    // One "+ row" per block on the paper, and blank trailing rows in two blocks.
    expect(html.match(/\+ row/g)).toHaveLength(4);
    expect(html.match(/class="blank"/g)).toHaveLength(3);
    const section = checklist();
    expect(section.allow_add_rows).toBe(true);
    // An added row answers, comments, numbers and files itself under a heading
    // exactly like a template row.
    expect(section.add_row_template).toEqual({
      type: "status",
      states: STATES,
      remarks: true,
      editable_no: true,
      editable_group: true,
    });
    // The blanks are places to add items, not empty template rows.
    expect(section.rows.every((r) => r.description.trim() !== "")).toBe(true);
  });

  it("keeps remarks and instruments in one box, unlinked from the register", () => {
    const section = template.sections.find((s) => s.id === "remarks")!;
    if (!isFieldGroupSection(section)) throw new Error("not a field group");
    expect(section.fields.map((f) => f.type)).toEqual(["textarea"]);
    // The sheet lists no instruments to tabulate, so nothing to declare.
    expect(template.instruments).toBeUndefined();
  });

  it("carries the sheet's three sign-off rows", () => {
    const html = readFileSync(SOURCE, "utf8");
    expect(html.match(/Tested By/g)).toHaveLength(1);
    expect(html.match(/Witnessed By/g)).toHaveLength(2);
    const section = template.sections.find((s) => s.id === "sign_off")!;
    if (!isSignOffSection(section)) throw new Error("not a sign-off section");
    expect(section.signatures.map((s) => s.role)).toEqual([
      "Tested By",
      "Witnessed By",
      "Witnessed By",
    ]);
    expect(section.signatures.map((s) => s.stage)).toEqual([
      "contractor",
      "witness",
      "client",
    ]);
  });

  it("carries no project data from the filled sample sheet", () => {
    const html = readFileSync(SOURCE, "utf8");
    const json = JSON.stringify(rawTemplate, (key, value) =>
      key === "_note" || key === "_status" ? undefined : value,
    );
    expect(html).toContain("Client: MS Project Merlion @IOI Building West Tower");
    expect(json).not.toContain("Merlion");
  });
});

describe("Chilled Water System Flushing Record — page layout", () => {
  it("prints the checklist on one sheet and closes on a second", () => {
    // Measured with a filled record: header + checklist 195mm of a 233mm body,
    // remarks + sign-off 140mm. Two sheets, the count the source HTML prints.
    const breaks = template.sections.map(
      (s) => (s as { page_break_before?: boolean }).page_break_before === true,
    );
    expect(breaks).toEqual([true, true, false]);
  });

  it("declares a break on the first section so sections share a sheet", () => {
    // `paginate` gives every section its own page unless at least one section
    // declares a break. Without this the record printed 7 pages.
    const first = template.sections[0]!;
    expect((first as { page_break_before?: boolean }).page_break_before).toBe(
      true,
    );
  });

  it("closes with an in-flow sign-off, not a footer page", () => {
    // The top-level footer takes a sheet of its own, which made the record three
    // sheets where the paper is one.
    expect(template.footer).toBeUndefined();
    expect(template.sections.at(-1)!.id).toBe("sign_off");
  });
});
