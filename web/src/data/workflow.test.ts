import { describe, it, expect } from "vitest";
import { parseTemplate, type SignatureStage } from "@schema";
import rawTemplate from "../../../spec/templates/heat-load-test.json";
import { createDraft, type ChecklistRecord, type RecordStatus } from "./record";
import type { Role } from "./roles";
import { uuidv7 } from "./uuidv7";
import {
  actionsFrom,
  checkAction,
  fieldsEditable,
  isLocked,
  satisfiedStages,
  transition,
  type WorkflowContext,
} from "./workflow";

const template = parseTemplate(rawTemplate);

function draft(status: RecordStatus = "draft"): ChecklistRecord {
  return {
    ...createDraft(template, { id: uuidv7(), now: "2026-08-02T00:00:00.000Z", createdBy: "u" }),
    status,
  };
}

function ctx(over: Partial<WorkflowContext> = {}): WorkflowContext {
  return {
    role: "site_engineer",
    satisfiedStages: new Set<SignatureStage>(["contractor", "check", "witness", "client"]),
    fieldsComplete: true,
    ...over,
  };
}

describe("satisfiedStages", () => {
  it("treats a stage with no slots as satisfied, and one with unsigned slots as not", () => {
    const none = satisfiedStages(template, new Set());
    // heat-load has one contractor slot; the second Tested-by is unstaged, so the
    // check/witness/client stages have no slots and are satisfied vacuously.
    expect(none.has("check")).toBe(true);
    expect(none.has("witness")).toBe(true);
    expect(none.has("client")).toBe(true);
    expect(none.has("contractor")).toBe(false);
  });

  it("marks a stage satisfied once all its slots are signed", () => {
    const s = satisfiedStages(template, new Set(["sig_tested"]));
    expect(s.has("contractor")).toBe(true); // the sole contractor slot is signed
  });
});

describe("checkAction — complete", () => {
  it("allows a Site Engineer when fields are complete and the contractor signed", () => {
    expect(checkAction("draft", "complete", ctx()).allowed).toBe(true);
  });

  it("blocks the wrong role", () => {
    const r = checkAction("draft", "complete", ctx({ role: "qa_qc" }));
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/Site Engineer/);
  });

  it("blocks when required fields are missing", () => {
    const r = checkAction("draft", "complete", ctx({ fieldsComplete: false }));
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/required fields/i);
  });

  it("blocks when the contractor signature is missing", () => {
    const r = checkAction("draft", "complete", ctx({ satisfiedStages: new Set(["check", "witness", "client"]) }));
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/Tested By/);
  });
});

describe("transition", () => {
  it("completes a draft and stamps completed_at", () => {
    const res = transition({
      record: draft(),
      action: "complete",
      ctx: ctx(),
      now: "2026-08-02T03:00:00.000Z",
    });
    expect(res.to).toBe("completed");
    expect(res.record.status).toBe("completed");
    expect(res.record.completed_at).toBe("2026-08-02T03:00:00.000Z");
  });

  it("throws on an illegal move", () => {
    expect(() =>
      transition({ record: draft(), action: "accept", ctx: ctx(), now: "t" }),
    ).toThrow();
  });

  it("walks the full happy path to accepted", () => {
    let rec = draft();
    rec = transition({ record: rec, action: "complete", ctx: ctx(), now: "t1" }).record;
    rec = transition({ record: rec, action: "submit_for_witness", ctx: ctx({ role: "qa_qc" }), now: "t2" }).record;
    rec = transition({ record: rec, action: "witness", ctx: ctx({ role: "qa_qc" }), now: "t3" }).record;
    rec = transition({ record: rec, action: "accept", ctx: ctx({ role: "qa_qc" }), now: "t4" }).record;
    expect(rec.status).toBe("accepted");
    expect(isLocked(rec.status)).toBe(true);
  });

  it("requires a reason to reject", () => {
    const base = draft("completed");
    expect(() =>
      transition({ record: base, action: "reject", ctx: ctx({ role: "qa_qc" }), now: "t" }),
    ).toThrow(/reason/i);
    const res = transition({
      record: base,
      action: "reject",
      ctx: ctx({ role: "qa_qc" }),
      now: "t",
      reason: "Ambient out of range",
    });
    expect(res.to).toBe("rejected");
  });
});

describe("actionsFrom", () => {
  it("offers the right actions per state", () => {
    expect(actionsFrom("draft")).toEqual(["complete"]);
    expect(actionsFrom("completed")).toEqual(["submit_for_witness", "reject"]);
    expect(actionsFrom("witnessed")).toEqual(["accept", "reject"]);
    expect(actionsFrom("accepted")).toEqual([]);
    expect(actionsFrom("rejected")).toEqual([]);
  });
});

describe("locking helpers", () => {
  it("locks only accepted; fields editable only in draft", () => {
    const roles: Role[] = ["site_engineer", "qa_qc"];
    expect(roles.length).toBe(2); // roles model present
    expect(isLocked("accepted")).toBe(true);
    expect(isLocked("witnessed")).toBe(false);
    expect(fieldsEditable("draft")).toBe(true);
    expect(fieldsEditable("completed")).toBe(false);
  });
});
