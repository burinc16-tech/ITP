import { describe, it, expect } from "vitest";
import { ChecklistDb } from "./db";
import { SignaturesRepo } from "./signatures-repo";
import { createSignature, type CapturedSignature } from "./signature";
import { uuidv7 } from "./uuidv7";

function freshRepo(): SignaturesRepo {
  return new SignaturesRepo(new ChecklistDb(`test-${uuidv7()}`));
}

function signature(over: Partial<CapturedSignature> = {}): CapturedSignature {
  return {
    ...createSignature({
      id: uuidv7(),
      recordId: "rec-1",
      slotId: "sig_tested",
      role: "Tested by",
      name: "A. Engineer",
      company: "Kenyon Pte Ltd",
      image: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
      signedByUser: "stub-user",
      deviceId: "device-1",
      now: "2026-08-02T02:00:00.000Z",
    }),
    ...over,
  };
}

describe("SignaturesRepo", () => {
  it("stores a signature and reads it back by record, with attribution intact", async () => {
    const repo = freshRepo();
    const sig = signature();
    await repo.add(sig);

    const rows = await repo.listByRecord("rec-1");
    expect(rows).toHaveLength(1);
    const stored = rows[0]!;
    expect(stored.name).toBe("A. Engineer");
    expect(stored.company).toBe("Kenyon Pte Ltd");
    expect(stored.role).toBe("Tested by");
    expect(stored.slot_id).toBe("sig_tested");
    expect(stored.method).toBe("on_device");
    expect(stored.device_id).toBe("device-1");
    expect(stored.signed_by_user).toBe("stub-user");
    expect(stored.signed_at).toBe("2026-08-02T02:00:00.000Z");
    // The image survives the round-trip. (Real IndexedDB returns a Blob;
    // fake-indexeddb degrades it to a plain object, so just assert presence.)
    expect(stored.image).toBeDefined();
  });

  it("is append-only — re-adding the same id is rejected, never overwritten", async () => {
    const repo = freshRepo();
    const sig = signature({ name: "Original" });
    await repo.add(sig);

    await expect(
      repo.add({ ...sig, name: "Tampered" }),
    ).rejects.toBeDefined();

    const rows = await repo.listByRecord("rec-1");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("Original");
  });

  it("scopes listByRecord to one record", async () => {
    const repo = freshRepo();
    await repo.add(signature({ record_id: "rec-1", slot_id: "sig_tested" }));
    await repo.add(signature({ record_id: "rec-1", slot_id: "sig_witness" }));
    await repo.add(signature({ record_id: "rec-2", slot_id: "sig_tested" }));

    expect(await repo.listByRecord("rec-1")).toHaveLength(2);
    expect(await repo.listByRecord("rec-2")).toHaveLength(1);
  });
});
