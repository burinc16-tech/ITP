import { afterEach, describe, it, expect, vi } from "vitest";
import type { AuditEntry } from "./audit";
import type { ChecklistRecord } from "./record";
import type { CapturedSignature } from "./signature";
import { ApiTransport, publishConflict, subscribeConflicts } from "./sync";

/** A minimal Response stand-in — the transport only reads ok/status/json(). */
const R = (status: number, body: unknown = {}): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

const stubFetch = (fn: ReturnType<typeof vi.fn>): void => {
  vi.stubGlobal("fetch", fn);
};

afterEach(() => {
  vi.unstubAllGlobals();
});

const record = { id: "r1", updated_at: "t", template_version_id: "T@1" } as ChecklistRecord;
// jsdom's Blob doesn't implement arrayBuffer(); a stub is all blobToDataUrl reads.
const pngBlob = {
  type: "image/png",
  arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
} as unknown as Blob;
const signature = {
  id: "s1",
  record_id: "r1",
  slot_id: "sig_tested",
  role: "Tested by",
  name: "A. Engineer",
  company: "Kenyon",
  method: "drawn",
  signed_by_user: "u",
  device_id: "d",
  signed_at: "t",
  image: pngBlob,
} as unknown as CapturedSignature;
const audit = { id: "a1", record_id: "r1", action: "complete" } as unknown as AuditEntry;

describe("ApiTransport — record push", () => {
  it("returns the server's applied/conflict on a 2xx", async () => {
    const f = vi.fn().mockResolvedValue(R(200, { applied: true, conflict: true }));
    stubFetch(f);
    const t = new ApiTransport("http://api", "tok");
    await expect(t.pushRecord(record)).resolves.toEqual({ applied: true, conflict: true });
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api/api/records");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });

  it("defaults applied to true when the body omits it, conflict to false", async () => {
    stubFetch(vi.fn().mockResolvedValue(R(200, {})));
    const t = new ApiTransport("http://api", "tok");
    await expect(t.pushRecord(record)).resolves.toEqual({ applied: true, conflict: false });
  });

  it("throws on a retryable status (5xx/401) so the queue reschedules", async () => {
    for (const status of [401, 500, 503]) {
      stubFetch(vi.fn().mockResolvedValue(R(status)));
      const t = new ApiTransport("http://api", "tok");
      await expect(t.pushRecord(record)).rejects.toThrow(String(status));
    }
  });

  it("throws on a network failure", async () => {
    stubFetch(vi.fn().mockRejectedValue(new Error("offline")));
    const t = new ApiTransport("http://api", "tok");
    await expect(t.pushRecord(record)).rejects.toThrow("offline");
  });

  it("treats a 400 as terminal — resolves so the entry drops rather than poisoning the queue", async () => {
    stubFetch(vi.fn().mockResolvedValue(R(400, { error: "invalid record" })));
    const t = new ApiTransport("http://api", "tok");
    await expect(t.pushRecord(record)).resolves.toEqual({ applied: false, conflict: false });
  });

  it("omits the auth header when there is no token", async () => {
    const f = vi.fn().mockResolvedValue(R(200, {}));
    stubFetch(f);
    await new ApiTransport("http://api", () => null).pushRecord(record);
    const [, init] = f.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });
});

describe("ApiTransport — evidence push", () => {
  it("resolves and posts the signature image as a data URL on a 201", async () => {
    const f = vi.fn().mockResolvedValue(R(201, { applied: true }));
    stubFetch(f);
    await expect(new ApiTransport("http://api", "tok").pushSignature(signature)).resolves.toBeUndefined();
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api/api/records/r1/signatures");
    expect(JSON.parse(init.body as string).image).toMatch(/^data:image\/png;base64,/);
  });

  it("resolves on an insert-once no-op (200 applied:false)", async () => {
    stubFetch(vi.fn().mockResolvedValue(R(200, { applied: false })));
    await expect(new ApiTransport("http://api", "tok").pushSignature(signature)).resolves.toBeUndefined();
  });

  it("treats a 409 evidence conflict as terminal — resolves rather than retrying forever", async () => {
    stubFetch(vi.fn().mockResolvedValue(R(409, { error: "evidence_conflict" })));
    await expect(new ApiTransport("http://api", "tok").pushSignature(signature)).resolves.toBeUndefined();
    await expect(new ApiTransport("http://api", "tok").pushAudit(audit)).resolves.toBeUndefined();
  });

  it("throws on a 404 (parent record not synced yet) so the queue retries", async () => {
    stubFetch(vi.fn().mockResolvedValue(R(404)));
    await expect(new ApiTransport("http://api", "tok").pushAudit(audit)).rejects.toThrow("404");
  });

  it("pull swallows a failure and returns null", async () => {
    stubFetch(vi.fn().mockResolvedValue(R(500)));
    await expect(new ApiTransport("http://api", "tok").pull("r1")).resolves.toBeNull();
  });
});

describe("conflict bus", () => {
  it("delivers a published record id to subscribers and stops after unsubscribe", () => {
    const seen: string[] = [];
    const off = subscribeConflicts((id) => seen.push(id));
    publishConflict("r1");
    off();
    publishConflict("r2");
    expect(seen).toEqual(["r1"]);
  });
});
