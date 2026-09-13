import { describe, expect, it } from "vitest";
import { CURRENT_TEMPLATES, TEMPLATES } from "./templates";
import { templateVersionId } from "./data/record";

/**
 * The bundled library parses. `templates.ts` validates at module scope, so a
 * template that fails Zod throws before React mounts and the app renders a blank
 * page — importing this module *is* the assertion. Per-template tests exercise
 * their own JSON directly and never touch this list, which is how an invalid
 * template reached production once already.
 */
describe("bundled templates", () => {
  it("all parse against the schema", () => {
    expect(TEMPLATES.length).toBeGreaterThan(0);
  });

  it("have unique version ids", () => {
    // A code may appear more than once — every revision stays bundled so the
    // records filed under it keep rendering (SPEC §2) — but never twice at the
    // same rev.
    const ids = TEMPLATES.map(templateVersionId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("offer one current revision per code for new records", () => {
    const codes = CURRENT_TEMPLATES.map((t) => t.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toEqual([...new Set(TEMPLATES.map((t) => t.code))]);
    // The one revised template so far: the Inspection Request Form is at Rev B,
    // and Rev A is bundled but not offered.
    expect(CURRENT_TEMPLATES.find((t) => t.code === "IRF")?.rev).toBe("B");
    expect(TEMPLATES.filter((t) => t.code === "IRF").map((t) => t.rev)).toEqual(["A", "B"]);
  });
});
