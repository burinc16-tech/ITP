import { describe, it, expect } from "vitest";
import { TEMPLATES } from "../templates";

/**
 * Which templates print at compact density (SPEC §7, `page.density`).
 *
 * Every template was rendered filled and signed, laid out at true A4 in a
 * browser, and each printed page measured against its sheet. These eleven
 * overflowed — the sign-off, or the tail of a long table, spilled onto an extra
 * sheet — and fit on one sheet at compact density. The rest were left at normal
 * spacing, which tracks the source paper forms more closely.
 *
 * The list is asserted rather than described so a template edit that drops the
 * attribute — or a new form that needs it — fails here instead of on a printer.
 */
const COMPACT = [
  "ASC", // AHU actual vs site comparison
  "CPF", // Condensate pipe flood test
  "DAL", // Ductwork air leakage test
  "DFT", // DX FCU function test
  "EBD", // Emergency light battery duration
  "HLT", // Heat load test
  "IDF", // IDF handover checklist
  "PAS", // PA system test
  "PTO", // Power turn-on form
  "SCR", // Sensor calibration record
  "VAB", // VAV air balancing
];

describe("print density", () => {
  it("keeps compact density on the templates measured to need it", () => {
    const compact = TEMPLATES.filter((t) => t.page.density === "compact")
      .map((t) => t.code)
      .sort();
    expect(compact).toEqual(COMPACT);
  });

  it("leaves every other template at the source form's normal spacing", () => {
    for (const t of TEMPLATES) {
      if (!COMPACT.includes(t.code)) expect(t.page.density).toBeUndefined();
    }
  });
});
