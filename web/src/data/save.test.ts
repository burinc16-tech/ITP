import { describe, it, expect, vi } from "vitest";
import { parseTemplate } from "@schema";
import rawTemplate from "../../../spec/templates/heat-load-test.json";
import { ChecklistDb } from "./db";
import { RecordsRepo } from "./records-repo";
import { PassthroughSync, type SyncLayer } from "./sync";
import { saveRecord } from "./save";
import { createDraft } from "./record";
import { setRowValue } from "../lib/values";
import { uuidv7 } from "./uuidv7";

const template = parseTemplate(rawTemplate);

function freshRepo(): RecordsRepo {
  return new RecordsRepo(new ChecklistDb(`test-${uuidv7()}`));
}

function draft() {
  return createDraft(template, {
    id: uuidv7(),
    now: "2026-07-30T00:00:00.000Z",
    createdBy: "tester",
  });
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
