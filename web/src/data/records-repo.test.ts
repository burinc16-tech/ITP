import { describe, it, expect } from "vitest";
import { parseTemplate } from "@schema";
import rawTemplate from "../../../spec/templates/heat-load-test.json";
import { ChecklistDb } from "./db";
import { RecordsRepo } from "./records-repo";
import { createDraft, templateVersionId } from "./record";
import { uuidv7 } from "./uuidv7";

const template = parseTemplate(rawTemplate);

/** Fresh, isolated store per test (fake-indexeddb shares a global backend). */
function freshRepo(): RecordsRepo {
  return new RecordsRepo(new ChecklistDb(`test-${uuidv7()}`));
}

function draft(now: string): ReturnType<typeof createDraft> {
  return createDraft(template, { id: uuidv7(), now, createdBy: "tester" });
}

describe("RecordsRepo", () => {
  it("stores and retrieves a record by id", async () => {
    const repo = freshRepo();
    const record = draft("2026-07-30T00:00:00.000Z");
    await repo.upsert(record);
    expect(await repo.get(record.id)).toEqual(record);
  });

  it("upserts idempotently — same id replaces, never duplicates", async () => {
    const repo = freshRepo();
    const record = draft("2026-07-30T00:00:00.000Z");
    await repo.upsert(record);
    await repo.upsert({ ...record, serial_no: "AMK3-HLT-0001" });
    const all = await repo.list();
    expect(all).toHaveLength(1);
    expect(all[0]!.serial_no).toBe("AMK3-HLT-0001");
  });

  it("resumes the most recently updated draft for a template", async () => {
    const repo = freshRepo();
    await repo.upsert(draft("2026-07-30T09:00:00.000Z"));
    const newest = draft("2026-07-30T11:00:00.000Z");
    await repo.upsert(newest);
    await repo.upsert(draft("2026-07-30T10:00:00.000Z"));

    const resumed = await repo.latestDraft(templateVersionId(template));
    expect(resumed?.id).toBe(newest.id);
  });

  it("ignores non-draft records when resuming", async () => {
    const repo = freshRepo();
    const completed = { ...draft("2026-07-30T12:00:00.000Z"), status: "completed" as const };
    await repo.upsert(completed);
    expect(await repo.latestDraft(templateVersionId(template))).toBeUndefined();
  });

  it("finds a record's successor revision via bySupersedes", async () => {
    const repo = freshRepo();
    const prev = { ...draft("2026-08-02T00:00:00.000Z"), status: "rejected" as const };
    const next = { ...draft("2026-08-02T05:00:00.000Z"), rev: 2, supersedes: prev.id };
    await repo.upsert(prev);
    await repo.upsert(next);
    expect((await repo.bySupersedes(prev.id))?.id).toBe(next.id);
    expect(await repo.bySupersedes(next.id)).toBeUndefined();
  });

  it("resumes a still-open rejected record, but not one already revised", async () => {
    const repo = freshRepo();
    const versionId = templateVersionId(template);

    const openReject = { ...draft("2026-08-02T00:00:00.000Z"), status: "rejected" as const };
    await repo.upsert(openReject);
    expect((await repo.latestOpenRejected(versionId))?.id).toBe(openReject.id);

    // Once superseded by a next rev, it is no longer "open".
    const next = { ...draft("2026-08-02T06:00:00.000Z"), rev: 2, supersedes: openReject.id };
    await repo.upsert(next);
    expect(await repo.latestOpenRejected(versionId)).toBeUndefined();
  });

  /**
   * The §8 durable pull: on login the server's record set is merged in, so a
   * cleared browser (or a second device) gets every synced record back instead
   * of an empty register.
   */
  it("mergeRemote restores server records into an empty store", async () => {
    const repo = freshRepo();
    const remote = [draft("2026-08-01T00:00:00.000Z"), draft("2026-08-02T00:00:00.000Z")];
    const written = await repo.mergeRemote(remote);
    expect(written).toBe(2);
    expect(await repo.list()).toHaveLength(2);
  });

  it("mergeRemote never clobbers a newer local copy, but applies a newer remote one", async () => {
    const repo = freshRepo();
    const record = draft("2026-08-01T00:00:00.000Z");
    const localEdit = { ...record, serial_no: "LOCAL", updated_at: "2026-08-03T00:00:00.000Z" };
    await repo.upsert(localEdit);

    // The server holds an older copy — a pull must not undo the local edit.
    const written = await repo.mergeRemote([{ ...record, serial_no: "STALE" }]);
    expect(written).toBe(0);
    expect((await repo.get(record.id))!.serial_no).toBe("LOCAL");

    // A newer server copy (e.g. accepted on another device) wins.
    await repo.mergeRemote([
      { ...record, status: "accepted", updated_at: "2026-08-04T00:00:00.000Z" },
    ]);
    expect((await repo.get(record.id))!.status).toBe("accepted");
  });
});
