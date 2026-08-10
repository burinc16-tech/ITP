import { describe, expect, it } from "vitest";
import { TEMPLATES } from "./templates";

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

  it("have unique codes", () => {
    const codes = TEMPLATES.map((t) => t.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
