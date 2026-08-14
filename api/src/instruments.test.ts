import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import {
  MemoryInstrumentStore,
  MemoryRecordStore,
  MemorySessionStore,
  MemoryUserStore,
} from "./store";
import { hashToken } from "./token";

async function make() {
  const store = new MemoryRecordStore();
  const users = new MemoryUserStore();
  const sessions = new MemorySessionStore();
  const instruments = new MemoryInstrumentStore();
  await users.create({
    id: "u1",
    email: "e@s.co",
    name: "E",
    role: "site_engineer",
    password_hash: "x",
    created_at: "t",
  });
  await sessions.create({
    id: "s1",
    user_id: "u1",
    token_hash: await hashToken("tok"),
    created_at: "t",
    expires_at: "2999-01-01T00:00:00.000Z",
  });
  const app = createApp({ store, users, sessions, instruments });
  const authed = { authorization: "Bearer tok", "content-type": "application/json" };
  return { app, authed, instruments };
}

const body = (over: Record<string, unknown> = {}) => ({
  id: "i1",
  serial_no: "W8045321",
  description: "Clamp Meter",
  cal_cert_url: "certs/clamp.pdf",
  cal_date: "2026-05-07",
  cal_due_date: "2027-05-07",
  updated_at: "2026-08-11T00:00:00.000Z",
  deleted: 0,
  ...over,
});

/**
 * The calibration register's server side (SPEC §4, §10 screen 9). Before this
 * existed the register lived only in the browser that typed it, so an instrument
 * added in the office was invisible on site.
 */
describe("api /api/instruments", () => {
  it("requires a session", async () => {
    const { app } = await make();
    const res = await app.request("/api/instruments");
    expect(res.status).toBe(401);
  });

  it("stores an instrument and lists it back", async () => {
    const { app, authed } = await make();

    const post = await app.request("/api/instruments", {
      method: "POST",
      headers: authed,
      body: JSON.stringify(body()),
    });
    expect(post.status).toBe(200);

    const res = await app.request("/api/instruments", { headers: authed });
    const json = (await res.json()) as { instruments: Array<Record<string, unknown>> };
    expect(json.instruments).toHaveLength(1);
    expect(json.instruments[0]).toMatchObject({ id: "i1", serial_no: "W8045321", deleted: 0 });
  });

  it("upserts by client id rather than duplicating", async () => {
    const { app, authed } = await make();
    await app.request("/api/instruments", {
      method: "POST",
      headers: authed,
      body: JSON.stringify(body()),
    });

    await app.request("/api/instruments", {
      method: "POST",
      headers: authed,
      body: JSON.stringify(
        body({ description: "Clamp Meter (recalibrated)", updated_at: "2026-09-01T00:00:00.000Z" }),
      ),
    });

    const res = await app.request("/api/instruments", { headers: authed });
    const json = (await res.json()) as { instruments: Array<Record<string, unknown>> };
    expect(json.instruments).toHaveLength(1);
    expect(json.instruments[0]!.description).toBe("Clamp Meter (recalibrated)");
  });

  it("drops a stale push so an offline device cannot resurrect old values", async () => {
    const { app, authed } = await make();
    await app.request("/api/instruments", {
      method: "POST",
      headers: authed,
      body: JSON.stringify(body({ description: "current", updated_at: "2026-09-01T00:00:00.000Z" })),
    });

    // A device that has been offline since before the edit pushes its old copy.
    await app.request("/api/instruments", {
      method: "POST",
      headers: authed,
      body: JSON.stringify(body({ description: "stale", updated_at: "2026-01-01T00:00:00.000Z" })),
    });

    const res = await app.request("/api/instruments", { headers: authed });
    const json = (await res.json()) as { instruments: Array<Record<string, unknown>> };
    expect(json.instruments[0]!.description).toBe("current");
  });

  it("returns tombstones so a delete made elsewhere can be applied", async () => {
    const { app, authed } = await make();
    await app.request("/api/instruments", {
      method: "POST",
      headers: authed,
      body: JSON.stringify(body()),
    });
    await app.request("/api/instruments", {
      method: "POST",
      headers: authed,
      body: JSON.stringify(body({ deleted: 1, updated_at: "2026-09-02T00:00:00.000Z" })),
    });

    const res = await app.request("/api/instruments", { headers: authed });
    const json = (await res.json()) as { instruments: Array<Record<string, unknown>> };
    expect(json.instruments).toHaveLength(1);
    expect(json.instruments[0]!.deleted).toBe(1);
  });

  it("rejects a body with no id or no updated_at", async () => {
    const { app, authed } = await make();
    for (const bad of [{ serial_no: "x" }, { id: "i9" }]) {
      const res = await app.request("/api/instruments", {
        method: "POST",
        headers: authed,
        body: JSON.stringify(bad),
      });
      expect(res.status).toBe(400);
    }
  });
});
