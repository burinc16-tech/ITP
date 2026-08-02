import { describe, it, expect } from "vitest";
import { parseTemplate } from "@schema";
import rawTemplate from "../../../spec/templates/heat-load-test.json";
import { createDraft, reviseRejected, type ChecklistRecord } from "./record";
import { uuidv7 } from "./uuidv7";

const template = parseTemplate(rawTemplate);

function rejected(): ChecklistRecord {
  const draft = createDraft(template, {
    id: uuidv7(),
    now: "2026-08-02T00:00:00.000Z",
    createdBy: "engineer",
  });
  draft.values.header.doc_no = "ITR-9";
  return {
    ...draft,
    status: "rejected",
    rev: 1,
    completed_at: "2026-08-02T01:00:00.000Z",
    context_snapshot: { resolved_at: "x" },
    serial_no: "AMK3-HLT-0009",
  };
}

describe("reviseRejected", () => {
  it("produces an editable next-rev draft that supersedes the rejected record", () => {
    const prev = rejected();
    const next = reviseRejected(prev, {
      id: uuidv7(),
      now: "2026-08-02T05:00:00.000Z",
      createdBy: "engineer",
    });

    expect(next.status).toBe("draft");
    expect(next.rev).toBe(2);
    expect(next.supersedes).toBe(prev.id);
    expect(next.id).not.toBe(prev.id);
    // Fresh rev: no carried-over snapshot, serial, or completion.
    expect(next.context_snapshot).toBeNull();
    expect(next.serial_no).toBeNull();
    expect(next.completed_at).toBeNull();
    expect(next.created_at).toBe("2026-08-02T05:00:00.000Z");
    // Values are copied so the engineer edits from where it was.
    expect(next.values.header.doc_no).toBe("ITR-9");
  });

  it("deep-copies values — editing the new rev never touches the rejected one", () => {
    const prev = rejected();
    const next = reviseRejected(prev, { id: uuidv7(), now: "t", createdBy: "e" });
    next.values.header.doc_no = "ITR-9-B";
    expect(prev.values.header.doc_no).toBe("ITR-9");
  });

  it("refuses to revise a record that is not rejected", () => {
    const draft = createDraft(template, { id: uuidv7(), now: "t", createdBy: "e" });
    expect(() => reviseRejected(draft, { id: uuidv7(), now: "t", createdBy: "e" })).toThrow();
  });
});

describe("createDraft scope", () => {
  it("populates registry scope when given", () => {
    const rec = createDraft(template, {
      id: "r1",
      now: "t",
      createdBy: "u",
      projectId: "p1",
      systemId: "s1",
      equipmentId: "e1",
    });
    expect(rec.project_id).toBe("p1");
    expect(rec.system_id).toBe("s1");
    expect(rec.equipment_id).toBe("e1");
    expect(rec.scope_type).toBe("equipment");
  });

  it("defaults scope ids to null when omitted", () => {
    const rec = createDraft(template, { id: "r2", now: "t", createdBy: "u" });
    expect(rec.project_id).toBeNull();
    expect(rec.system_id).toBeNull();
    expect(rec.equipment_id).toBeNull();
  });
});
