import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  isDynamicTableSection,
  isFieldGroupSection,
  isSignOffSection,
  isStandardSection,
  parseTemplate,
  type DynamicTableSection,
  type StandardSection,
} from "@schema";
import rawTemplate from "../../../spec/templates/condensate-pipe-flood-test.json";
import { CURRENT_TEMPLATES, TEMPLATES } from "../templates";

/**
 * Parity between the CPF Rev B template and the MOS-ACMV-006 sheet it came from.
 *
 * Rev B is a different form from Rev A, not a revision of its wording, and Rev A
 * is deliberately NOT bundled — no record was ever filed under it (SPEC §12).
 * The first test pins that, so a later "keep every revision" tidy-up cannot
 * quietly resurrect a sheet no consultant will accept any more.
 *
 * The rest pins the three conversion calls: the paper's Requirement column
 * carried into the row descriptions and enforced by `limit`; the two figures
 * the paper's script computes (duration, level drop) carried as TYPED readings
 * because a standard row has no formula evaluation, against the one figure that
 * IS computed (Part B recovery); and the acceptance-criteria prose carried as
 * the closing section's title, so it still prints.
 */

const SOURCE = resolve(
  process.cwd(),
  "spec/Condensate_Drainpipe_Flood_and_Flow_Test.html",
);
const template = parseTemplate(rawTemplate);
const html = readFileSync(SOURCE, "utf8");

/** The template's WORDING — what prints — with its provenance notes stripped. */
const wording = JSON.stringify(rawTemplate, (key, value) =>
  key === "_note" || key === "_status" || key === "source" ? undefined : value,
);

function standard(id: string): StandardSection {
  const section = template.sections.find((s) => s.id === id)!;
  if (!isStandardSection(section)) throw new Error(`${id} is not standard`);
  return section;
}

function table(id: string): DynamicTableSection {
  const section = template.sections.find((s) => s.id === id)!;
  if (!isDynamicTableSection(section)) throw new Error(`${id} is not a table`);
  return section;
}

/** The paper's description cell for a Part A item, tags and its edit-only hints stripped. */
function paperItem(no: string): string {
  const match = html.match(
    new RegExp(`<td class="c">${no}</td><td>(.*?)</td>`, "s"),
  );
  if (!match) throw new Error(`no item ${no} in the source form`);
  return match[1]!
    .replace(/<span class="edit-only"[^>]*>.*?<\/span>/s, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .trim();
}

describe("Condensate Drainpipe Flood & Flow Test — parity with MOS-ACMV-006", () => {
  it("is Rev B of CPF, with Rev A withdrawn rather than frozen", () => {
    expect(template.code).toBe("CPF");
    expect(template.rev).toBe("B");
    expect(template.title).toBe("Condensate Drainpipe Flood & Flow Test Record");
    expect(html).toContain("CONDENSATE DRAINPIPE FLOOD &amp; FLOW TEST RECORD");
    expect(template.discipline).toBe("ACMV");
    expect(template.category).toBe("ITR");
    // A drain run is tested by where it is, not by a tag — Part B lists the AHUs.
    expect(template.scope).toBe("location");
    expect(template.page).toEqual({ size: "A4", orientation: "portrait", density: "compact" });

    // Production held no CPF@A record when Rev B landed, so nothing is bundled
    // for a frozen Rev A to serve (the opposite call from IRF, SPEC §12).
    expect(TEMPLATES.filter((t) => t.code === "CPF").map((t) => t.rev)).toEqual(["B"]);
    expect(CURRENT_TEMPLATES.find((t) => t.code === "CPF")?.rev).toBe("B");
    expect(template.source).toContain("Rev B replaces Rev A outright");
  });

  it("carries the paper's project block as the header, with only the constants defaulted", () => {
    expect(template.header.fields.map((f) => [f.id, f.label, f.default])).toEqual([
      ["project", "Project", undefined],
      ["contractor", "Contractor", "Kenyon Pte Ltd"],
      ["mos_ref", "MOS Reference", "MOS-ACMV-006"],
    ]);
    for (const label of ["Project", "Contractor", "MOS Reference"]) {
      expect(html).toContain(`>${label}</span>`);
    }
    expect(html).toContain(">Kenyon Pte Ltd</span>");
    expect(html).toContain(">MOS-ACMV-006</span>");
    // The supplied file was saved with a project's own name in it — a record
    // value, not a default.
    expect(html).toContain("AMK1 300 KVA UPS System C");
    expect(wording).not.toContain("AMK1");
    // Nothing populates `source` yet, so nothing here is `readonly` — a
    // readonly cell with no source prints permanently blank.
    for (const f of template.header.fields) expect(f.readonly).toBeUndefined();
  });

  it("carries the general-information grid, six cells in the paper's order, unit as a property", () => {
    const info = template.sections[0]!;
    if (!isFieldGroupSection(info)) throw new Error("first section is not a field group");
    expect(info.id).toBe("general_info");
    expect(info.fields.map((f) => f.label)).toEqual([
      "Location",
      "Ref. No.",
      "Test Area",
      "Drawing Ref.",
      "Pipe Material / Size",
      "Test Section Length",
    ]);
    for (const label of ["Location", "Ref. No.", "Test Area", "Drawing Ref.", "Pipe Material / Size"]) {
      expect(html).toContain(`<td class="b shade">${label}</td>`);
    }
    // The paper writes the unit into the label; the renderer appends it here.
    expect(html).toContain("Test Section Length (m)");
    const length = info.fields.find((f) => f.id === "length")!;
    expect(length.type).toBe("number");
    expect(length.unit).toBe("m");
    expect(length.label).not.toContain("(");
  });

  it("carries Part A's nine items with the paper's wording, date/time rows split", () => {
    const partA = standard("part_a");
    expect(partA.title).toBe(
      "PART A – CONDENSATE DRAIN PIPE FLOOD TEST (MOS-ACMV-006, Clause 6.2)",
    );
    expect(html).toContain(
      "PART A – CONDENSATE DRAIN PIPE FLOOD TEST (MOS-ACMV-006, Clause 6.2)",
    );
    expect(partA.columns?.result?.label).toBe("Reading / Record");
    expect(html).toContain('<td class="b">Reading / Record</td>');

    // Every numbered row begins with the paper's own description; the tail is
    // the paper's Requirement cell, carried into the description (next test).
    const numbered = partA.rows.filter((r) => r.no !== undefined);
    expect(numbered.map((r) => r.no)).toEqual(["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9"]);
    for (const no of ["A1", "A2", "A4", "A7", "A9"]) {
      const row = numbered.find((r) => r.no === no)!;
      expect(row.description.startsWith(paperItem(no))).toBe(true);
    }
    expect(numbered.find((r) => r.no === "A6")!.description).toMatch(/^Test duration/);
    expect(numbered.find((r) => r.no === "A8")!.description).toMatch(
      /^Drop in water level \(A4 – A7\)/,
    );
    expect(paperItem("A8")).toBe("Drop in water level (A4 – A7)");

    // A3 and A5 are one Date/Time row each on the paper; a checklist row carries
    // one control, so each is a dated row plus an unnumbered timed continuation.
    const ids = partA.rows.map((r) => [r.id, r.no, r.type]);
    expect(ids.slice(2, 4)).toEqual([
      ["start_date", "A3", "date"],
      ["start_time", undefined, "time"],
    ]);
    expect(ids.slice(5, 7)).toEqual([
      ["end_date", "A5", "date"],
      ["end_time", undefined, "time"],
    ]);
    expect(html).toContain('data-f="a3d"');
    expect(html).toContain('data-f="a3t"');
  });

  it("carries the paper's Requirement column as row text enforced by `limit`", () => {
    const partA = standard("part_a");
    const req = (id: string) => partA.rows.find((r) => r.id === id)!;
    // The paper's screen-only ✓/✗ thresholds, from its recalc() — the same
    // figures its Requirement cells print.
    expect(html).toContain("a1>=1.0");
    expect(html).toContain("a2>=30");
    expect(html).toContain("h>=2");
    expect(html).toContain("d<=0");
    expect([req("test_head").limit, req("test_head").unit]).toEqual([{ min: 1 }, "m"]);
    expect([req("settlement").limit, req("settlement").unit]).toEqual([{ min: 30 }, "min"]);
    expect([req("duration").limit, req("duration").unit]).toEqual([{ min: 2 }, "h"]);
    expect([req("level_drop").limit, req("level_drop").unit]).toEqual([{ max: 0 }, "mm"]);
    for (const [id, text] of [
      ["test_head", "≥ 1.0 m"],
      ["settlement", "≥ 30 min"],
      ["duration", "≥ 2 h"],
      ["level_drop", "no drop"],
      ["leakage", "No"],
    ] as const) {
      expect(req(id).description.endsWith(text)).toBe(true);
    }
    for (const cell of ["≥ 1.0 m", "≥ 30 min", "≥ 2 h", "No drop"]) {
      expect(html).toContain(`>${cell}</td>`);
    }
    // Readings the paper does not judge carry no limit.
    for (const id of ["level_start", "level_end"]) {
      expect(req(id).limit).toBeUndefined();
      expect(req(id).unit).toBe("mm");
    }
  });

  it("types the two figures the paper computes, and computes the one a row can", () => {
    // The source derives A6 (A5 − A3) and A8 (A4 − A7) in its script. A standard
    // row has no formula evaluation, so both are typed readings here.
    expect(html).toContain("(auto from A3/A5)");
    const partA = standard("part_a");
    for (const id of ["duration", "level_drop"]) {
      const row = partA.rows.find((r) => r.id === id)!;
      expect(row.type).toBe("number");
      expect(row.formula).toBeUndefined();
    }
    // Part B's recovery IS computed — both inputs are columns of the same row.
    const recovery = table("part_b").columns.find((c) => c.id === "recovery")!;
    expect(recovery.type).toBe("calculated");
    expect(recovery.formula).toBe("collected / poured * 100");
    expect(recovery.decimals).toBe(1);
    expect(recovery.unit).toBe("%");
    expect(html).toContain("const pct=c/p*100; r.value=pct.toFixed(1)");
    // The paper's 90% acceptance figure, declared even though a calculated
    // column's limit is not yet evaluated anywhere (template `_note`).
    expect(recovery.limit).toEqual({ min: 90 });
    expect(html).toContain("pct>=90");
  });

  it("maps the outcomes, leakage the reverse of the rest", () => {
    const partA = standard("part_a");
    const outcomes = (id: string) =>
      Object.fromEntries(
        partA.rows.find((r) => r.id === id)!.states!.map((s) => [s.value, s.outcome]),
      );
    // Seeing leakage is the failure — the one inversion in Part A.
    expect(outcomes("leakage")).toEqual({ yes: "fail", no: "pass" });
    expect(outcomes("flood_result")).toEqual({ pass: "pass", fail: "fail" });
    expect(partA.rows.find((r) => r.id === "flood_result")!.states!.map((s) => s.label)).toEqual([
      "PASS",
      "FAIL",
    ]);
    expect(html).toContain('data-v="PASS">PASS</span>/<span class="opt neg" data-v="FAIL">FAIL</span>');
    expect(html).toContain('<span class="opt neg" data-v="Yes">Yes</span>/<span class="opt pos" data-v="No">No</span>');
  });

  it("carries Part B as a per-AHU table seeded the way the paper is", () => {
    const partB = table("part_b");
    expect(partB.title).toBe(
      "PART B – CONDENSATE DRAIN PIPE FLOW TEST (MOS-ACMV-006, Clause 6.3)",
    );
    expect(html).toContain(
      "PART B – CONDENSATE DRAIN PIPE FLOW TEST (MOS-ACMV-006, Clause 6.3)",
    );
    expect(partB.auto_number).toBe(true);
    expect(partB.number_label).toBe("S/N");
    expect(partB.columns.map((c) => c.label)).toEqual([
      "AHU Tag No.",
      "Volume Poured",
      "Volume Collected",
      "Recovery",
      "Free flow, no ponding / leak",
      "Result",
    ]);
    for (const heading of [
      "S/N",
      "AHU Tag No.",
      "Volume Poured (L)",
      "Volume Collected (L)",
      "Recovery (%)",
      "Free flow, no ponding / leak",
      "Result",
    ]) {
      expect(html).toContain(`<td class="b${heading === "S/N" ? " c" : ""}">${heading}</td>`);
    }
    // Units are properties, never written into the label.
    for (const id of ["poured", "collected"]) {
      const col = partB.columns.find((c) => c.id === id)!;
      expect(col.type).toBe("number");
      expect(col.unit).toBe("L");
      expect(col.label).not.toContain("(");
    }

    // Five rows drawn, each with 1.5 L poured by default — and the default
    // follows an appended row, as the paper's generated rows carry it.
    expect(html).toContain("const ROWS = 5;");
    expect(html).toContain('value="1.5"');
    expect(partB.min_rows).toBe(5);
    expect(partB.prefilled_rows).toEqual(Array(5).fill({ poured: 1.5 }));
    expect(partB.columns.find((c) => c.id === "poured")!.carry_down).toBe(true);

    // The paper's own words for the two choices; Yes and P pass.
    const states = (id: string) =>
      partB.columns.find((c) => c.id === id)!.states!.map((s) => [s.label, s.outcome]);
    expect(states("flow")).toEqual([["Yes", "pass"], ["No", "fail"]]);
    expect(states("result")).toEqual([["P", "pass"], ["F", "fail"]]);
    expect(html).toContain('data-v="P">P</span>/<span class="opt neg" data-v="F">F</span>');
  });

  it("prints the acceptance criteria as the closing section's title, above the remarks box", () => {
    const closing = template.sections.find((s) => s.id === "closing")!;
    if (!isFieldGroupSection(closing)) throw new Error("closing is not a field group");
    const flood = "no visible leakage and no drop in water level over the 2-hour test period.";
    const flow =
      "volume collected ≥ 90% of volume poured (≥ 1.35 L for 1.5 L); water drains freely with no ponding, backflow or leakage.";
    expect(closing.title.startsWith("Acceptance Criteria (MOS-ACMV-006, Section 7)")).toBe(true);
    expect(closing.title).toContain(`Flood test: ${flood}`);
    expect(closing.title).toContain(`Flow test: ${flow}`);
    expect(html).toContain("Acceptance Criteria (MOS-ACMV-006, Section 7):");
    expect(html).toContain(`<b>Flood test –</b> ${flood}`);
    expect(html).toContain(`<b>Flow test –</b> ${flow}`);

    expect(closing.fields.map((f) => [f.id, f.type])).toEqual([
      ["instruments_used", "textarea"],
      ["remarks", "textarea"],
      ["att_drawing", "checkbox"],
      ["att_photo", "checkbox"],
    ]);
    expect(html).toContain('data-f="instruments"');
    expect(html).toContain('data-f="remarks"');
    expect(html).toContain('data-f="attDrawing"> Marked-up drawing');
    expect(html).toContain('data-f="attPhoto"> Photo record (start / end level, water collected)');
    expect(closing.fields.find((f) => f.id === "att_photo")!.label).toContain(
      "Photo record (start / end level, water collected)",
    );
    // No calibration table on the paper, so no instruments block to feed.
    expect(template.instruments).toBeUndefined();
  });

  it("closes with the paper's three roles, one per gated step, attachments above them", () => {
    const signOff = template.sections.at(-1)!;
    if (!isSignOffSection(signOff)) throw new Error("last section is not sign-off");
    expect(signOff.signatures.map((s) => [s.role, s.stage, s.required])).toEqual([
      ["Tested By", "contractor", true],
      ["Witnessed By (T&C Consultant)", "witness", false],
      ["Verified By (Client, if any)", "client", false],
    ]);
    const tested = signOff.signatures[0]!;
    expect(tested.company_default).toBe("Kenyon Pte Ltd");
    expect(tested.company_locked).toBe(true);
    for (const cell of [
      'data-f="testedRole">Tested By',
      'data-f="testedOrg">(Kenyon)',
      'data-f="witnessRole">Witnessed By',
      'data-f="witnessOrg">(T&amp;C Consultant – NDR)',
      'data-f="verifiedRole">Verified By',
      'data-f="verifiedOrg">(Client, if any)',
    ]) {
      expect(html).toContain(cell);
    }
    // NDR is one project's consultant — a record value — so it is not template wording.
    expect(wording).not.toContain("NDR");
    // One sign-off block, in the flow — the footer would take a page of its own.
    expect(template.footer).toBeUndefined();
    const ids = template.sections.map((s) => s.id);
    expect(ids.indexOf("closing")).toBe(ids.indexOf("sign_off") - 1);
  });

  it("breaks into two pages where the live build measured", () => {
    // A break on the opening section is a no-op — it is already page 1 — and is
    // what stops `paginate` giving every section a sheet of its own.
    //
    // Measured on the live build at compact density, against the 970px an A4
    // page gives its body (`_claude_tmp/render-cpf-check.tsx`, 20 Sep 2026):
    //   1  header + General Information + Part A     blank 481px   filled 519px
    //   2  Part B + criteria/remarks + sign-off       blank 527px   filled 624px
    // The seven-column Part B table sits exactly on the 703px body width with
    // no overrun. The paper is one dense sheet; the app's spacing makes it two,
    // which is the library norm, not a defect.
    const breaks = template.sections
      .filter((s) => (s as { page_break_before?: boolean }).page_break_before === true)
      .map((s) => s.id);
    expect(breaks).toEqual(["general_info", "part_b"]);
  });

  it("carries none of the standalone form's own machinery", () => {
    for (const chrome of ["Save Filled Form", "Finalise", "Clear pad", "Apply signature", "Page 1 of 1"]) {
      expect(html).toContain(chrome);
      expect(wording).not.toContain(chrome);
    }
  });
});
