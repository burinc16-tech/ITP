import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import {
  MemoryRecordStore,
  MemorySessionStore,
  MemorySignatureStore,
  MemoryUserStore,
} from "./store";
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

/**
 * Soft-delete tombstones (register Delete). The server mirrors the client rule
 * (Hard Rule #6): only an unsigned draft/completed record may be tombstoned.
 * 409 is terminal for the sync queue — a refused delete is never retried.
 */
describe("api record delete tombstones", () => {
  it("accepts a tombstone for an unsigned draft and lists it back", async () => {
    const { app, authed } = await make();
    await app.request("/api/records", {
      method: "POST",
      headers: authed,
      body: JSON.stringify(record()),
    });
    const del = await app.request("/api/records", {
      method: "POST",
      headers: authed,
      body: JSON.stringify(record({ deleted: true, updated_at: "2026-08-02T02:00:00.000Z" })),
    });
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ applied: true });

    // The tombstone rides the list so other devices can apply the delete.
    const list = await app.request("/api/records", { headers: authed });
    const body = (await list.json()) as { records: Array<{ id: string; deleted?: boolean }> };
    expect(body.records).toHaveLength(1);
    expect(body.records[0]!.deleted).toBe(true);
  });

  it("refuses a tombstone once the record is past completed", async () => {
    const { app, authed } = await make();
    await app.request("/api/records", {
      method: "POST",
      headers: authed,
      body: JSON.stringify(record({ status: "witnessed" })),
    });
    const del = await app.request("/api/records", {
      method: "POST",
      headers: authed,
      body: JSON.stringify(
        record({ status: "witnessed", deleted: true, updated_at: "2026-08-02T02:00:00.000Z" }),
      ),
    });
    expect(del.status).toBe(409);
  });

  it("refuses a tombstone for a record that has signatures (Hard Rule #6)", async () => {
    const store = new MemoryRecordStore();
    const users = new MemoryUserStore();
    const sessions = new MemorySessionStore();
    const signatures = new MemorySignatureStore();
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
    await signatures.add({
      id: "sig1",
      record_id: "r1",
      slot_id: "sig_contractor",
      role: "contractor",
      name: "Eng",
      company: "Kenyon",
      method: "on_device",
      signed_by_user: "u1",
      device_id: "dev-1",
      image_key: "signatures/sig1.png",
      signed_at: "2026-08-02T01:30:00.000Z",
      signer_email: null,
      signer_ip: null,
    });
    const app = createApp({ store, users, sessions, signatures });
    const authed = { authorization: "Bearer sess-token", "content-type": "application/json" };

    await app.request("/api/records", {
      method: "POST",
      headers: authed,
      body: JSON.stringify(record()),
    });
    const del = await app.request("/api/records", {
      method: "POST",
      headers: authed,
      body: JSON.stringify(record({ deleted: true, updated_at: "2026-08-02T02:00:00.000Z" })),
    });
    expect(del.status).toBe(409);

    // The record survives untouched.
    const get = await app.request("/api/records/r1", { headers: authed });
    expect(((await get.json()) as { deleted?: boolean }).deleted).toBeUndefined();
  });
});
