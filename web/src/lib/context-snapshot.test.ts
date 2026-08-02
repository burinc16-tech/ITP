import { describe, it, expect } from "vitest";
import { parseTemplate } from "@schema";
import rawTemplate from "../../../spec/templates/heat-load-test.json";
import { createEquipment, createProject, createSystem } from "../data/registry";
import { buildContextSnapshot } from "./context-snapshot";
import { emptyValues } from "./values";

const template = parseTemplate(rawTemplate);

describe("buildContextSnapshot", () => {
  it("resolves {{variables}} into literal step text and snapshots the inputs", () => {
    const values = emptyValues(template);
    values.variables.load_kw = "8"; // override the default of 6
    const snap = buildContextSnapshot(template, values, "2026-08-02T03:00:00.000Z");

    expect(snap.resolved_at).toBe("2026-08-02T03:00:00.000Z");
    expect(snap.variables.load_kw).toBe("8");
    // s2_01 description is "Check {{load_kw}} kW load banks are installed."
    expect(snap.descriptions.s2_01).toBe("Check 8 kW load banks are installed.");
    // No unresolved tokens remain anywhere.
    for (const text of Object.values(snap.descriptions)) {
      expect(text).not.toMatch(/\{\{/);
    }
  });

  it("captures header values as entered", () => {
    const values = emptyValues(template);
    values.header.doc_no = "ITR-007";
    const snap = buildContextSnapshot(template, values, "t");
    expect(snap.header.doc_no).toBe("ITR-007");
  });

  it("denormalizes the linked project/system/equipment names (§2)", () => {
    const snap = buildContextSnapshot(template, emptyValues(template), "t", {
      project: createProject({ id: "p1", now: "t", code: "AMK3", name: "AMK", client: "KC" }),
      system: createSystem({ id: "s1", projectId: "p1", name: "Electrical", code: "E" }),
      equipment: createEquipment({
        id: "e1",
        projectId: "p1",
        systemId: "s1",
        tag: "DB-1",
        description: "Main DB",
      }),
    });
    expect(snap.scope.project).toEqual({ code: "AMK3", name: "AMK", client: "KC" });
    expect(snap.scope.system).toEqual({ code: "E", name: "Electrical" });
    expect(snap.scope.equipment?.tag).toBe("DB-1");
  });

  it("has null scope when the record is unscoped", () => {
    const snap = buildContextSnapshot(template, emptyValues(template), "t");
    expect(snap.scope.project).toBeNull();
    expect(snap.scope.equipment).toBeNull();
  });
});
