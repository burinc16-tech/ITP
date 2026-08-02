import { describe, it, expect } from "vitest";
import type { Variable } from "@schema";
import { buildVarMap, interpolate } from "./interpolate";

describe("interpolate", () => {
  const vars = { fcu_chw: "CHW-FCU-A-NR-401", load_kw: "6", setpoint: "23" };

  it("replaces a known token", () => {
    expect(interpolate("Set {{fcu_chw}} keypad", vars)).toBe(
      "Set CHW-FCU-A-NR-401 keypad",
    );
  });

  it("replaces every occurrence, across multiple tokens", () => {
    expect(interpolate("{{load_kw}} kW to {{setpoint}}°C, {{load_kw}} kW", vars)).toBe(
      "6 kW to 23°C, 6 kW",
    );
  });

  it("tolerates whitespace inside the braces", () => {
    expect(interpolate("{{ setpoint }}°C", vars)).toBe("23°C");
  });

  it("leaves an unknown token literal so a missing variable is visible", () => {
    expect(interpolate("kick in {{missing}} now", vars)).toBe(
      "kick in {{missing}} now",
    );
  });

  it("returns text with no tokens unchanged", () => {
    expect(interpolate("End of test.", vars)).toBe("End of test.");
  });
});

describe("buildVarMap", () => {
  const variables: Variable[] = [
    { id: "fcu_chw", label: "CHW FCU tag", type: "text", default: "CHW-A" },
    { id: "load_kw", label: "Load", type: "number", unit: "kW", default: 6 },
    { id: "note", label: "Note", type: "text" },
  ];

  it("uses the entered value when present", () => {
    const map = buildVarMap(variables, { fcu_chw: "CHW-B", load_kw: "8" });
    expect(map.fcu_chw).toBe("CHW-B");
    expect(map.load_kw).toBe("8");
  });

  it("falls back to the template default, coerced to a string", () => {
    const map = buildVarMap(variables, {});
    expect(map.fcu_chw).toBe("CHW-A");
    expect(map.load_kw).toBe("6");
  });

  it("treats an empty entered value as absent and uses the default", () => {
    const map = buildVarMap(variables, { fcu_chw: "" });
    expect(map.fcu_chw).toBe("CHW-A");
  });

  it("yields an empty string for a variable with no value and no default", () => {
    const map = buildVarMap(variables, {});
    expect(map.note).toBe("");
  });

  it("handles a template with no variables", () => {
    expect(buildVarMap(undefined, {})).toEqual({});
  });
});
