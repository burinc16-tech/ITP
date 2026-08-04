import { describe, it, expect } from "vitest";
import { createAttachment } from "./attachment";
import { AttachmentsRepo } from "./attachments-repo";
import { ChecklistDb } from "./db";
import { uuidv7 } from "./uuidv7";

function freshRepo(): AttachmentsRepo {
  return new AttachmentsRepo(new ChecklistDb(`test-${uuidv7()}`));
}

const png = (n: number) => new Blob([new Uint8Array([n])], { type: "image/png" });

function photo(recordId: string, fieldId: string, now: string, byte = 1) {
  return createAttachment({
    id: uuidv7(),
    recordId,
    fieldId,
    image: png(byte),
    deviceId: "d",
    now,
  });
}

describe("createAttachment", () => {
  it("defaults mime from the blob, caption to empty, kind to photo", () => {
    const a = createAttachment({ id: "a1", recordId: "r1", fieldId: "f1", image: png(1), deviceId: "d", now: "t" });
    expect(a.kind).toBe("photo");
    expect(a.mime).toBe("image/png");
    expect(a.caption).toBe("");
  });
});

describe("AttachmentsRepo", () => {
  it("lists a record's attachments oldest-first", async () => {
    const repo = freshRepo();
    await repo.add(photo("r1", "f1", "2026-08-04T00:00:02.000Z"));
    await repo.add(photo("r1", "f2", "2026-08-04T00:00:01.000Z"));
    await repo.add(photo("other", "f1", "2026-08-04T00:00:00.000Z"));

    const rows = await repo.listByRecord("r1");
    expect(rows).toHaveLength(2); // scoped to the record
    expect(rows[0]!.created_at < rows[1]!.created_at).toBe(true); // oldest first
  });

  it("recaptions and removes", async () => {
    const repo = freshRepo();
    const a = photo("r1", "f1", "t");
    await repo.add(a);

    await repo.setCaption(a.id, "north face");
    expect((await repo.get(a.id))?.caption).toBe("north face");

    await repo.remove(a.id);
    expect(await repo.get(a.id)).toBeUndefined();
    expect(await repo.listByRecord("r1")).toHaveLength(0);
  });
});
