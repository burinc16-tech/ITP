import { describe, it, expect, vi } from "vitest";
import { requestPersistentStorage } from "./persist";

/** A StorageManager stub; `estimate` is unused but part of the interface. */
function storageManager(parts: {
  persisted: () => Promise<boolean>;
  persist: () => Promise<boolean>;
}): StorageManager {
  return { ...parts, estimate: async () => ({}) } as StorageManager;
}

describe("requestPersistentStorage", () => {
  it("asks for persistence when the origin is still best-effort", async () => {
    const persist = vi.fn(async () => true);
    const granted = await requestPersistentStorage(
      storageManager({ persisted: async () => false, persist }),
    );
    expect(granted).toBe(true);
    expect(persist).toHaveBeenCalledOnce();
  });

  it("does not ask again once the origin is already persistent", async () => {
    const persist = vi.fn(async () => true);
    const granted = await requestPersistentStorage(
      storageManager({ persisted: async () => true, persist }),
    );
    expect(granted).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it("reports a refusal without throwing — the app carries on regardless", async () => {
    const granted = await requestPersistentStorage(
      storageManager({ persisted: async () => false, persist: async () => false }),
    );
    expect(granted).toBe(false);
  });

  it("survives a browser with no Storage API (insecure context, old browser)", async () => {
    await expect(requestPersistentStorage(undefined)).resolves.toBe(false);
    await expect(
      requestPersistentStorage({} as StorageManager),
    ).resolves.toBe(false);
  });

  it("survives the call throwing rather than resolving false", async () => {
    const granted = await requestPersistentStorage(
      storageManager({
        persisted: async () => false,
        persist: () => Promise.reject(new Error("denied")),
      }),
    );
    expect(granted).toBe(false);
  });
});
