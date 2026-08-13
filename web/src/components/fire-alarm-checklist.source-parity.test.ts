import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  isFieldGroupSection,
  isSignOffSection,
  isStandardSection,
  parseTemplate,
} from "@schema";
import rawTemplate from "../../../spec/templates/fire-alarm-checklist.json";

/**
 * Parity between the converted template and the sheet it came from.
 *
 * The source ships twelve worded items under four bold category headings,
 * followed by four blank numbered rows (13–16). This asserts the wording is
 * carried across verbatim — including the two items the sheet deliberately
 * repeats under a second category — and that the blanks became
 * `allow_add_rows` rather than empty template rows (SPEC §12, Hard Rule §5).
 *
 * The paper's one table is two sections here, split at the last category so it
 * fits A4; the checks below read them as the single run of items they are.
 */

const SOURCE = resolve(process.cwd(), "spec/Fire_Alarm_Checklist.html");
const template = parseTemplate(rawTemplate);

const checklist = template.sections.find((s) => s.id === "checklist")!;
const checklistCont = template.sections.find((s) => s.id === "checklist_cont")!;
if (!isStandardSection(checklist) || !isStandardSection(checklistCont))
  throw new Error("the checklist sections are not standard sections");

/** Both halves of the split table, in printed order. */
const allRows = [...checklist.rows, ...checklistCont.rows];

/** The worded `<td class="item">` items of the source sheet, in order. */
function sourceItems(): string[] {
  const html = readFileSync(SOURCE, "utf8");
  return [...html.matchAll(/<td class="item">(\d+)\.\s*([^<]*)<\/td>/g)].map(
    (m) => m[2]!.replace(/&amp;/g, "&").trim(),
  );
}

/** The shaded category rows of the source sheet, in order. */
function sourceGroups(): string[] {
  const html = readFileSync(SOURCE, "utf8");
  return [...html.matchAll(/<tr class="cat">.*?<strong>([^<]*):<\/strong>/g)].map(
    (m) => m[1]!.trim(),
  );
}

describe("Fire Alarm System checklist — parity with the source sheet", () => {
  it("is a portrait Electrical ITR scoped to a location", () => {
    expect(template.code).toBe("FAS");
    expect(template.title).toBe("Check List for Fire Alarm System");
    expect(template.discipline).toBe("Electrical");
    expect(template.category).toBe("ITR");
    expect(template.scope).toBe("location");
    expect(template.page).toEqual({ size: "A4", orientation: "portrait" });
  });

  it("carries the sheet's six document fields as the record header", () => {
    expect(template.header.fields.map((f) => f.id)).toEqual([
      "project",
      "ref_no",
      "test_date",
      "drawing_no",
      "drawing_rev",
      "location",
    ]);
    const location = template.header.fields.find((f) => f.id === "location")!;
    expect(location.source).toBe("equipment.location");
    expect(location.required).toBe(true);
  });

  it("carries all twelve worded items verbatim, and only those", () => {
    const items = sourceItems();
    expect(items).toHaveLength(12);
    expect(allRows).toHaveLength(12);
    expect(allRows.map((r) => r.description)).toEqual(items);
    expect(allRows.map((r) => r.no)).toEqual([
      "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12",
    ]);
  });

  it("splits the table on a category boundary, numbering running on", () => {
    // The break falls where the paper already draws a shaded heading, so no
    // category is torn across the two sheets.
    expect(checklist.rows.map((r) => r.no)).toEqual([
      "1", "2", "3", "4", "5", "6", "7", "8", "9",
    ]);
    expect(checklistCont.rows.every((r) => r.group === "Wiring and Connections")).toBe(true);
    // A continued table reprints its headings, so both halves head alike.
    expect(checklistCont.columns).toEqual(checklist.columns);
  });

  it("keeps the two items the sheet repeats under a second category", () => {
    // 5 and 8 are word-for-word identical on the paper, as are 6 and 9: the
    // same checks are answered separately for field devices and for
    // notification appliances. Matching the original wins (SPEC §5).
    const byNo = (no: string) => allRows.find((r) => r.no === no)!;
    expect(byNo("5").description).toBe(byNo("8").description);
    expect(byNo("6").description).toBe(byNo("9").description);
    expect(byNo("5").group).not.toBe(byNo("8").group);
  });

  it("heads its runs of items with the sheet's four categories", () => {
    expect(sourceGroups()).toEqual([
      "General",
      "Field Devices",
      "Notification Appliances",
      "Wiring and Connections",
    ]);
    // Consecutive rows sharing a `group` render under one heading.
    const runs = allRows
      .map((r) => r.group)
      .filter((g, i, all) => g !== all[i - 1]);
    expect(runs).toEqual(sourceGroups());
  });

  it("answers YES / N/A / NO on every row, in the sheet's own order", () => {
    for (const row of allRows) {
      expect(row.type).toBe("status");
      expect(row.states?.map((s) => s.label)).toEqual(["Yes", "N/A", "No"]);
      // A "No" answer must be derivable as an outstanding item (SPEC §6).
      expect(row.states?.map((s) => s.outcome)).toEqual(["pass", "na", "fail"]);
      expect(row.remarks).toBe(true);
    }
  });

  it("turns the sheet's four blank rows into add-your-own rows", () => {
    // The source numbers 13, 14, 15 and 16 with empty description inputs. None
    // of them may exist as template rows — an engineer's wording is record data.
    expect(readFileSync(SOURCE, "utf8")).toContain('<span class="num">13.</span>');
    // They belong to the tail section: the paper puts its blanks at the end of
    // the table, and an added row appends to the section it belongs to.
    expect(checklist.allow_add_rows).toBeUndefined();
    expect(checklistCont.allow_add_rows).toBe(true);
    expect(checklistCont.add_row_template?.type).toBe("status");
    expect(checklistCont.add_row_template?.states?.map((s) => s.label)).toEqual([
      "Yes",
      "N/A",
      "No",
    ]);
    expect(checklistCont.add_row_template?.remarks).toBe(true);
    expect(checklistCont.add_row_template?.editable_no).toBe(true);
    expect(checklistCont.add_row_template?.editable_group).toBe(true);
  });

  it("keeps the sheet's remarks box as a plain labelled field", () => {
    const remarks = template.sections.find((s) => s.id === "remarks")!;
    expect(isFieldGroupSection(remarks)).toBe(true);
    if (!isFieldGroupSection(remarks)) return;
    expect(remarks.fields.map((f) => f.type)).toEqual(["textarea"]);
  });
});

describe("Fire Alarm System checklist — page layout", () => {
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

  it("gives the checklist its own page and closes on the second", () => {
    expect(pages()).toEqual([
      ["checklist"],
      ["checklist_cont", "remarks", "sign_off"],
    ]);
    // Measured on the live build 2026-08-13 against a 232.2mm page body: page 1
    // 197.1mm, page 2 215.1mm with every item answered. Unsplit, the checklist
    // alone came to 234.3mm and pushed the sheet 11mm past A4.
  });

  it("keeps the sign-off in the flow rather than on a page of its own", () => {
    expect(template.footer).toBeUndefined();
    const signOff = template.sections.at(-1)!;
    expect(isSignOffSection(signOff)).toBe(true);
    if (!isSignOffSection(signOff)) return;
    expect(signOff.signatures.map((s) => s.role)).toEqual([
      "Performed By Sub / Main Contractor",
      "Witnessed By",
      "Witnessed By",
    ]);
    expect(signOff.signatures.map((s) => s.stage)).toEqual([
      "contractor",
      "witness",
      "client",
    ]);
    expect(signOff.signatures[0]!.company_default).toBe("Kenyon Pte Ltd");
  });
});
