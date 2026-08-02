import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import { MemoryRecordStore, MemorySessionStore, MemoryUserStore } from "./store";
import { hashToken } from "./token";

/**
 * Sync push of append-only evidence (SPEC §8, §12): on-device signatures and
 * client-authored audit entries. Covers auth, the missing-record guard, and the
 * insert-once contract — identical replay is a no-op, a same-id write with
 * different content is an evidence conflict (409), never an overwrite.
 */
async function make() {
  const store = new MemoryRecordStore();
  const users = new MemoryUserStore();
  const sessions = new MemorySessionStore();
  await users.create({
    id: "u1", email: "eng@site.co", name: "Eng",
    role: "site_engineer", password_hash: "x", created_at: "t",
  });
  await sessions.create({
    id: "s1", user_id: "u1", token_hash: await hashToken("sess-token"),
    created_at: "t", expires_at: "2999-01-01T00:00:00.000Z",
  });
  const app = createApp({ store, users, sessions });
  const authed = { authorization: "Bearer sess-token", "content-type": "application/json" };
  // Seed the record the evidence attaches to.
  await app.request("/api/records", {
    method: "POST",
    headers: authed,
    body: JSON.stringify({
      id: "r1", template_version_id: "HLT@A", status: "completed",
      updated_at: "2026-08-02T01:00:00.000Z", values: {},
    }),
  });
  return { app, authed };
}

// A tiny valid base64 payload; decodeImage only needs decodable base64, not a real PNG.
const IMAGE = "data:image/png;base64,AAAA";

function signatureBody(over: Record<string, unknown> = {}) {
  return {
    id: "sig-1", slot_id: "sig_tested", role: "Tested by",
    name: "A. Engineer", company: "Kenyon Pte Ltd", method: "on_device",
    signed_by_user: "u1", device_id: "dev-1",
    signed_at: "2026-08-02T02:00:00.000Z", image: IMAGE, ...over,
  };
}

function auditBody(over: Record<string, unknown> = {}) {
  return {
    id: "aud-1", record_id: "r1", user: "u1", role: "site_engineer",
    action: "complete", before: "draft", after: "completed",
    reason: null, at: "2026-08-02T02:00:00.000Z", ...over,
  };
}

const post = (app: ReturnType<typeof createApp>, url: string, headers: Record<string, string>, body: unknown) =>
  app.request(url, { method: "POST", headers, body: JSON.stringify(body) });

describe("POST /api/records/:id/signatures", () => {
  it("rejects without a session", async () => {
    const { app } = await make();
    const res = await post(app, "/api/records/r1/signatures", { "content-type": "application/json" }, signatureBody());
    expect(res.status).toBe(401);
  });

  it("404s when the record is absent", async () => {
    const { app, authed } = await make();
    const res = await post(app, "/api/records/nope/signatures", authed, signatureBody());
    expect(res.status).toBe(404);
  });

  it("stores a signature, then treats an identical replay as a no-op", async () => {
    const { app, authed } = await make();
    const first = await post(app, "/api/records/r1/signatures", authed, signatureBody());
    expect(first.status).toBe(201);
    expect(await first.json()).toEqual({ applied: true });

    const replay = await post(app, "/api/records/r1/signatures", authed, signatureBody());
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ applied: false });
  });

  it("409s a same-id signature whose content differs (evidence conflict)", async () => {
    const { app, authed } = await make();
    await post(app, "/api/records/r1/signatures", authed, signatureBody());
    const conflict = await post(app, "/api/records/r1/signatures", authed, signatureBody({ name: "Someone Else" }));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: "evidence_conflict" });
  });

  it("400s a signature with no image", async () => {
    const { app, authed } = await make();
    const res = await post(app, "/api/records/r1/signatures", authed, signatureBody({ image: "" }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/records/:id/audit", () => {
  it("rejects without a session", async () => {
    const { app } = await make();
    const res = await post(app, "/api/records/r1/audit", { "content-type": "application/json" }, auditBody());
    expect(res.status).toBe(401);
  });

  it("appends an entry, then treats an identical replay as a no-op", async () => {
    const { app, authed } = await make();
    const first = await post(app, "/api/records/r1/audit", authed, auditBody());
    expect(first.status).toBe(201);
    expect(await first.json()).toEqual({ applied: true });

    const replay = await post(app, "/api/records/r1/audit", authed, auditBody());
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ applied: false });
  });

  it("409s a same-id entry whose content differs", async () => {
    const { app, authed } = await make();
    await post(app, "/api/records/r1/audit", authed, auditBody());
    const conflict = await post(app, "/api/records/r1/audit", authed, auditBody({ action: "reject" }));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: "evidence_conflict" });
  });

  it("400s an entry missing required fields", async () => {
    const { app, authed } = await make();
    const res = await post(app, "/api/records/r1/audit", authed, { id: "aud-x" });
    expect(res.status).toBe(400);
  });
});
