import { describe, it, expect } from "vitest";
import { AuditRepo } from "./audit-repo";
import { createAuditEntry } from "./audit";
import { ChecklistDb } from "./db";
import { uuidv7 } from "./uuidv7";

function freshRepo(): AuditRepo {
  return new AuditRepo(new ChecklistDb(`test-${uuidv7()}`));
}

function entry(over: { recordId?: string; action?: string; now?: string } = {}) {
  return createAuditEntry({
    id: uuidv7(),
    recordId: over.recordId ?? "rec-1",
    user: "stub-user",
    role: "qa_qc",
    action: over.action ?? "complete",
    before: "draft",
    after: "completed",
    now: over.now ?? "2026-08-02T01:00:00.000Z",
  });
}

describe("AuditRepo", () => {
  it("appends entries and lists them oldest first, scoped to the record", async () => {
    const repo = freshRepo();
    await repo.add(entry({ action: "submit_for_witness", now: "2026-08-02T02:00:00.000Z" }));
    await repo.add(entry({ action: "complete", now: "2026-08-02T01:00:00.000Z" }));
    await repo.add(entry({ recordId: "rec-2", now: "2026-08-02T05:00:00.000Z" }));

    const rows = await repo.listByRecord("rec-1");
    expect(rows.map((r) => r.action)).toEqual(["complete", "submit_for_witness"]);
    expect(await repo.listByRecord("rec-2")).toHaveLength(1);
  });

  it("is append-only — a duplicate id is rejected", async () => {
    const repo = freshRepo();
    const e = entry();
    await repo.add(e);
    await expect(repo.add(e)).rejects.toBeDefined();
  });

  it("returns the most recent entries across records, newest first", async () => {
    const repo = freshRepo();
    await repo.add(entry({ action: "complete", now: "2026-08-02T01:00:00.000Z" }));
    await repo.add(entry({ recordId: "rec-2", action: "accept", now: "2026-08-02T03:00:00.000Z" }));
    await repo.add(entry({ action: "submit_for_witness", now: "2026-08-02T02:00:00.000Z" }));

    const recent = await repo.recent(2);
    expect(recent.map((e) => e.action)).toEqual(["accept", "submit_for_witness"]);
  });
});
