import { describe, it, expect } from "vitest";
import { parseTemplate } from "@schema";
import heatLoadRaw from "../../../spec/templates/heat-load-test.json";
import { createDraft, type ChecklistRecord, type RecordStatus } from "../data/record";
import { createProject, createSystem } from "../data/registry";
import { uuidv7 } from "../data/uuidv7";
import {
  completionByProject,
  completionBySystem,
  completionSummary,
} from "./completion";

const heatLoad = parseTemplate(heatLoadRaw);

function rec(status: RecordStatus, over: Partial<ChecklistRecord> = {}): ChecklistRecord {
  return {
    ...createDraft(heatLoad, { id: uuidv7(), now: "2026-08-02T00:00:00.000Z", createdBy: "u" }),
    status,
    ...over,
  };
}

describe("completionSummary", () => {
  it("counts one head per ITR and reports % accepted", () => {
    const accepted = rec("accepted");
    const draft = rec("draft");
    const rev1 = rec("rejected", { rev: 1 });
    const rev2 = rec("accepted", { rev: 2, supersedes: rev1.id });

    const summary = completionSummary([accepted, draft, rev1, rev2], [heatLoad]);

    // rev1 is superseded, so 3 heads: accepted, draft, rev2.
    expect(summary.total).toBe(3);
    expect(summary.accepted).toBe(2);
    expect(summary.percentComplete).toBe(67);
    expect(summary.byStatus.accepted).toBe(2);
    expect(summary.byStatus.draft).toBe(1);
    expect(summary.byStatus.rejected).toBe(0); // the only rejected is superseded

    expect(summary.byTemplate).toHaveLength(1);
    expect(summary.byTemplate[0]!.total).toBe(3);
    expect(summary.byTemplate[0]!.accepted).toBe(2);
  });

  it("reports 0% for an empty store", () => {
    const summary = completionSummary([], [heatLoad]);
    expect(summary.total).toBe(0);
    expect(summary.percentComplete).toBe(0);
  });
});

describe("completion by scope", () => {
  const project = createProject({ id: "p1", now: "t", code: "AMK3", name: "AMK", client: "C" });
  const system = createSystem({ id: "s1", projectId: "p1", name: "Electrical", code: "E" });

  it("groups by project with an Unassigned bucket", () => {
    const scoped = rec("accepted", { project_id: "p1", system_id: "s1" });
    const unscoped = rec("draft");
    const byProject = completionByProject([scoped, unscoped], [project]);

    expect(byProject).toContainEqual({ key: "p1", label: "AMK", total: 1, accepted: 1 });
    expect(byProject.find((x) => x.label === "Unassigned")).toMatchObject({
      total: 1,
      accepted: 0,
    });
  });

  it("groups by system", () => {
    const scoped = rec("accepted", { project_id: "p1", system_id: "s1" });
    const bySystem = completionBySystem([scoped], [system]);
    expect(bySystem).toContainEqual({ key: "s1", label: "Electrical", total: 1, accepted: 1 });
  });
});
