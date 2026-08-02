import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import { MemoryRecordStore, MemorySessionStore, MemoryUserStore } from "./store";
import { hashToken } from "./token";

/**
 * Build an app with a seeded session so the record-sync endpoints (which now
 * require a bearer session, task 4) can be exercised. Returns the app and the
 * authenticated headers.
 */
async function make() {
  const store = new MemoryRecordStore();
  const users = new MemoryUserStore();
  const sessions = new MemorySessionStore();
  await users.create({
    id: "u1",
    email: "eng@site.co",
    name: "Eng",
    role: "site_engineer",
    password_hash: "x",
    created_at: "t",
  });
  await sessions.create({
    id: "s1",
    user_id: "u1",
    token_hash: await hashToken("sess-token"),
    created_at: "t",
    expires_at: "2999-01-01T00:00:00.000Z",
  });
  const app = createApp({ store, users, sessions });
  const authed = { authorization: "Bearer sess-token", "content-type": "application/json" };
  return { app, authed };
}

function record(over: Record<string, unknown> = {}) {
  return {
    id: "r1",
    template_version_id: "HLT@A",
    status: "draft",
    updated_at: "2026-08-02T01:00:00.000Z",
    values: {},
    ...over,
  };
}

describe("api /api/records", () => {
  it("serves health without a session", async () => {
    const { app } = await make();
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("rejects a push without a session", async () => {
    const { app } = await make();
    const res = await app.request("/api/records", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(record()),
    });
    expect(res.status).toBe(401);
  });

  it("upserts a record and reads it back", async () => {
    const { app, authed } = await make();
    const post = await app.request("/api/records", {
      method: "POST",
      headers: authed,
      body: JSON.stringify(record()),
    });
    expect(post.status).toBe(200);
    expect(await post.json()).toEqual({ applied: true });

    const get = await app.request("/api/records/r1", { headers: authed });
    expect(get.status).toBe(200);
    const body = (await get.json()) as { template_version_id: string };
    expect(body.template_version_id).toBe("HLT@A");
  });

  it("is last-write-wins on updated_at", async () => {
    const { app, authed } = await make();
    await app.request("/api/records", {
      method: "POST",
      headers: authed,
      body: JSON.stringify(record({ updated_at: "2026-08-02T05:00:00.000Z", marker: "new" })),
    });
    const stale = await app.request("/api/records", {
      method: "POST",
      headers: authed,
      body: JSON.stringify(record({ updated_at: "2026-08-02T01:00:00.000Z", marker: "old" })),
    });
    expect(await stale.json()).toEqual({ applied: false });

    const get = await app.request("/api/records/r1", { headers: authed });
    const body = (await get.json()) as { marker: string };
    expect(body.marker).toBe("new");
  });

  it("rejects an invalid record body", async () => {
    const { app, authed } = await make();
    const res = await app.request("/api/records", {
      method: "POST",
      headers: authed,
      body: JSON.stringify({ id: "x" }),
    });
    expect(res.status).toBe(400);
  });

  it("locks an accepted record against a newer client push (§8)", async () => {
    const { app, authed } = await make();
    // Entering accepted is allowed — the prior draft is not locked.
    await app.request("/api/records", {
      method: "POST",
      headers: authed,
      body: JSON.stringify(record({ status: "accepted", updated_at: "2026-08-02T05:00:00.000Z", marker: "final" })),
    });
    // A later, newer client push must not overwrite it.
    const res = await app.request("/api/records", {
      method: "POST",
      headers: authed,
      body: JSON.stringify(record({ status: "witnessed", updated_at: "2026-08-02T06:00:00.000Z", marker: "stale" })),
    });
    expect(await res.json()).toEqual({ applied: false, conflict: true });

    const get = await app.request("/api/records/r1", { headers: authed });
    const body = (await get.json()) as { status: string; marker: string };
    expect(body.status).toBe("accepted");
    expect(body.marker).toBe("final");
  });

  it("locks a rejected record so a stale client transition can't clobber it (§8)", async () => {
    const { app, authed } = await make();
    await app.request("/api/records", {
      method: "POST",
      headers: authed,
      body: JSON.stringify(record({ status: "rejected", updated_at: "2026-08-02T05:00:00.000Z", marker: "rej" })),
    });
    const res = await app.request("/api/records", {
      method: "POST",
      headers: authed,
      body: JSON.stringify(record({ status: "witnessed", updated_at: "2026-08-02T06:00:00.000Z", marker: "stale" })),
    });
    expect(await res.json()).toEqual({ applied: false, conflict: true });

    const get = await app.request("/api/records/r1", { headers: authed });
    expect(((await get.json()) as { status: string }).status).toBe("rejected");
  });
});
