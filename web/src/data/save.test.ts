import { describe, it, expect, vi } from "vitest";
import { parseTemplate } from "@schema";
import rawTemplate from "../../../spec/templates/heat-load-test.json";
import { ChecklistDb } from "./db";
import { RecordsRepo } from "./records-repo";
import { SignaturesRepo } from "./signatures-repo";
import { PassthroughSync, type SyncLayer } from "./sync";
import { deleteRecord, saveRecord } from "./save";
import { createDraft, type ChecklistRecord } from "./record";
import type { CapturedSignature } from "./signature";
import { setRowValue } from "../lib/values";
import { uuidv7 } from "./uuidv7";

const template = parseTemplate(rawTemplate);

function freshDb(): ChecklistDb {
  return new ChecklistDb(`test-${uuidv7()}`);
}

function freshRepo(): RecordsRepo {
  return new RecordsRepo(freshDb());
}

function draft() {
  return createDraft(template, {
    id: uuidv7(),
    now: "2026-07-30T00:00:00.000Z",
    createdBy: "tester",
  });
}

function signature(recordId: string): CapturedSignature {
  return {
    id: uuidv7(),
    record_id: recordId,
    slot_id: "sig_contractor",
    role: "contractor",
    name: "Eng",
    company: "Kenyon",
    image: new Blob(["png"], { type: "image/png" }),
    method: "on_device",
    signed_by_user: "tester",
    device_id: "dev-1",
    signed_at: "2026-07-30T02:00:00.000Z",
  };
}

describe("saveRecord", () => {
  it("writes to Dexie and pushes through the sync layer", async () => {
    const repo = freshRepo();
    const sync: SyncLayer = {
      push: vi.fn().mockResolvedValue({ conflict: false }),
      pull: vi.fn().mockResolvedValue(null),
      pushSignature: vi.fn().mockResolvedValue(undefined),
      pushAudit: vi.fn().mockResolvedValue(undefined),
      pushAttachment: vi.fn().mockResolvedValue(undefined),
      pullAttachments: vi.fn().mockResolvedValue(null),
      pullAttachmentImage: vi.fn().mockResolvedValue(null),
      pushInstrument: vi.fn().mockResolvedValue(undefined),
      pullInstruments: vi.fn().mockResolvedValue(null),
      pushProject: vi.fn().mockResolvedValue(undefined),
      pushSystem: vi.fn().mockResolvedValue(undefined),
      pushEquipment: vi.fn().mockResolvedValue(undefined),
      pullRegistry: vi.fn().mockResolvedValue(null),
      pullRecords: vi.fn().mockResolvedValue(null),
    };
    const record = draft();

    const { record: saved, conflict } = await saveRecord(
      { repo, sync, clock: () => "2026-07-30T01:00:00.000Z" },
      record,
    );

    expect(saved.updated_at).toBe("2026-07-30T01:00:00.000Z");
    expect(conflict).toBe(false);
    expect(await repo.get(record.id)).toEqual(saved);
    expect(sync.push).toHaveBeenCalledOnce();
    expect(sync.push).toHaveBeenCalledWith(saved);
  });

  it("propagates a server lock conflict but still writes locally (§8)", async () => {
    const repo = freshRepo();
    const sync: SyncLayer = {
      push: vi.fn().mockResolvedValue({ conflict: true }),
      pull: vi.fn().mockResolvedValue(null),
      pushSignature: vi.fn().mockResolvedValue(undefined),
      pushAudit: vi.fn().mockResolvedValue(undefined),
      pushAttachment: vi.fn().mockResolvedValue(undefined),
      pullAttachments: vi.fn().mockResolvedValue(null),
      pullAttachmentImage: vi.fn().mockResolvedValue(null),
      pushInstrument: vi.fn().mockResolvedValue(undefined),
      pullInstruments: vi.fn().mockResolvedValue(null),
      pushProject: vi.fn().mockResolvedValue(undefined),
      pushSystem: vi.fn().mockResolvedValue(undefined),
      pushEquipment: vi.fn().mockResolvedValue(undefined),
      pullRegistry: vi.fn().mockResolvedValue(null),
      pullRecords: vi.fn().mockResolvedValue(null),
    };
    const record = draft();

    const { record: saved, conflict } = await saveRecord({ repo, sync }, record);

    expect(conflict).toBe(true);
    // The local write is durable regardless — the caller reconciles from here.
    expect(await repo.get(record.id)).toEqual(saved);
  });

  it("is idempotent — re-saving the same id updates in place", async () => {
    const repo = freshRepo();
    const sync = new PassthroughSync();
    const record = draft();

    await saveRecord({ repo, sync }, record);
    const edited = setRowValue(record.values, "s2_01", "pass");
    await saveRecord({ repo, sync }, { ...record, values: edited });

    const all = await repo.list();
    expect(all).toHaveLength(1);
    expect(all[0]!.values.rows.s2_01).toEqual({ value: "pass", remarks: "" });
  });

  it("keeps the record durable even though pass-through sync is a no-op", async () => {
    const repo = freshRepo();
    const record = draft();
    await saveRecord({ repo, sync: new PassthroughSync() }, record);
    expect(await repo.get(record.id)).toBeDefined();
  });
});

/**
 * Deletion is a synced soft-delete (tombstone), guarded by Hard Rule #6: only an
 * unsigned draft/completed record may ever be deleted.
 */
describe("deleteRecord", () => {
  function harness() {
    const db = freshDb();
    const repo = new RecordsRepo(db);
    const signatures = new SignaturesRepo(db);
    const pushed: ChecklistRecord[] = [];
    const sync: SyncLayer = Object.assign(new PassthroughSync(), {
      push: async (record: ChecklistRecord) => {
        pushed.push(record);
        return { conflict: false };
      },
    });
    return { repo, signatures, sync, pushed };
  }

  it("tombstones a draft, hides it from lists, and pushes the deletion", async () => {
    const { repo, signatures, sync, pushed } = harness();
    const record = draft();
    await repo.upsert(record);

    await deleteRecord({ repo, signatures, sync, clock: () => "2026-07-31T00:00:00.000Z" }, record.id);

    // Hidden from every view, but still a row — that is what syncs the delete.
    expect(await repo.list()).toHaveLength(0);
    const row = await repo.get(record.id);
    expect(row?.deleted).toBe(true);
    expect(row?.updated_at).toBe("2026-07-31T00:00:00.000Z");
    // The tombstone went through the normal record push path.
    expect(pushed).toHaveLength(1);
    expect(pushed[0]!.deleted).toBe(true);
  });

  it("is idempotent — deleting an already-deleted or missing record is a no-op", async () => {
    const { repo, signatures, sync, pushed } = harness();
    const record = draft();
    await repo.upsert(record);
    await deleteRecord({ repo, signatures, sync }, record.id);
    await deleteRecord({ repo, signatures, sync }, record.id); // second time
    await deleteRecord({ repo, signatures, sync }, uuidv7()); // never existed
    expect(pushed).toHaveLength(1);
  });

  it("refuses to delete a record past completed", async () => {
    const { repo, signatures, sync } = harness();
    const record = { ...draft(), status: "witnessed" as const };
    await repo.upsert(record);
    await expect(deleteRecord({ repo, signatures, sync }, record.id)).rejects.toThrow(
      /draft or completed/,
    );
    expect(await repo.list()).toHaveLength(1); // untouched
  });

  it("refuses to delete a signed record (Hard Rule #6)", async () => {
    const { repo, signatures, sync } = harness();
    const record = draft();
    await repo.upsert(record);
    await signatures.add(signature(record.id));
    await expect(deleteRecord({ repo, signatures, sync }, record.id)).rejects.toThrow(/signed/);
    expect(await repo.list()).toHaveLength(1); // untouched
  });
});
