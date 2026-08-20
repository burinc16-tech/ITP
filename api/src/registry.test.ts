import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import {
  MemoryRecordStore,
  MemoryRegistryStore,
  MemorySessionStore,
  MemoryUserStore,
} from "./store";
import { hashToken } from "./token";

async function make() {
  const store = new MemoryRecordStore();
  const users = new MemoryUserStore();
  const sessions = new MemorySessionStore();
  const registry = new MemoryRegistryStore();
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
  const app = createApp({ store, users, sessions, registry });
  const authed = { authorization: "Bearer tok", "content-type": "application/json" };
  return { app, authed, store };
}

const project = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  code: "AMK3",
  name: "AMK Data Centre",
  client: "Kenyon",
  status: "open",
  created_at: "2026-08-01T00:00:00.000Z",
  closed_at: null,
  updated_at: "2026-08-19T00:00:00.000Z",
  ...over,
});

/**
 * The project registry's server side (SPEC §4, §10 screen 8). Before this
 * existed the registry lived only in the browser that typed it — a cleared
 * browser lost every project, system and equipment tag, and nothing could
 * restore them.
 */
describe("api /api/registry", () => {
  it("requires a session", async () => {
    const { app } = await make();
    const res = await app.request("/api/registry");
    expect(res.status).toBe(401);
    const post = await app.request("/api/registry/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(project()),
    });
    expect(post.status).toBe(401);
  });

  it("stores each entity kind and lists the whole registry back", async () => {
    const { app, authed } = await make();

    const postProject = await app.request("/api/registry/projects", {
      method: "POST",
      headers: authed,
      body: JSON.stringify(project()),
    });
    expect(postProject.status).toBe(200);

    const postSystem = await app.request("/api/registry/systems", {
      method: "POST",
      headers: authed,
      body: JSON.stringify({
        id: "s1",
        project_id: "p1",
        name: "ACMV",
        code: "AC",
        parent_system_id: null,
        updated_at: "2026-08-19T00:00:00.000Z",
      }),
    });
    expect(postSystem.status).toBe(200);

    const postEquipment = await app.request("/api/registry/equipment", {
      method: "POST",
      headers: authed,
      body: JSON.stringify({
        id: "e1",
        project_id: "p1",
        system_id: "s1",
        tag: "FCU-01",
        description: "Fan coil",
        location: "L1",
        drawing_ref: "",
        updated_at: "2026-08-19T00:00:00.000Z",
      }),
    });
    expect(postEquipment.status).toBe(200);

    const res = await app.request("/api/registry", { headers: authed });
    const json = (await res.json()) as {
      projects: Array<Record<string, unknown>>;
      systems: Array<Record<string, unknown>>;
      equipment: Array<Record<string, unknown>>;
    };
    expect(json.projects).toHaveLength(1);
    expect(json.projects[0]).toMatchObject({ id: "p1", code: "AMK3" });
    expect(json.systems[0]).toMatchObject({ id: "s1", project_id: "p1", name: "ACMV" });
    expect(json.equipment[0]).toMatchObject({ id: "e1", system_id: "s1", tag: "FCU-01" });
  });

  it("upserts by client id rather than duplicating", async () => {
    const { app, authed } = await make();
    await app.request("/api/registry/projects", {
      method: "POST",
      headers: authed,
      body: JSON.stringify(project()),
    });
    await app.request("/api/registry/projects", {
      method: "POST",
      headers: authed,
      body: JSON.stringify(project({ name: "AMK DC (renamed)", updated_at: "2026-09-01T00:00:00.000Z" })),
    });

    const res = await app.request("/api/registry", { headers: authed });
    const json = (await res.json()) as { projects: Array<Record<string, unknown>> };
    expect(json.projects).toHaveLength(1);
    expect(json.projects[0]!.name).toBe("AMK DC (renamed)");
  });

  it("drops a stale push so an offline device cannot resurrect old values", async () => {
    const { app, authed } = await make();
    await app.request("/api/registry/projects", {
      method: "POST",
      headers: authed,
      body: JSON.stringify(project({ name: "current", updated_at: "2026-09-01T00:00:00.000Z" })),
    });
    await app.request("/api/registry/projects", {
      method: "POST",
      headers: authed,
      body: JSON.stringify(project({ name: "stale", updated_at: "2026-01-01T00:00:00.000Z" })),
    });

    const res = await app.request("/api/registry", { headers: authed });
    const json = (await res.json()) as { projects: Array<Record<string, unknown>> };
    expect(json.projects[0]!.name).toBe("current");
  });

  it("rejects a body missing its id, timestamp, or parent references", async () => {
    const { app, authed } = await make();
    const bads: Array<[string, Record<string, unknown>]> = [
      ["projects", { code: "X" }],
      ["projects", { id: "p9" }],
      ["systems", { id: "s9", updated_at: "t" }], // no project_id
      ["equipment", { id: "e9", updated_at: "t", project_id: "p1" }], // no system_id
    ];
    for (const [kind, bad] of bads) {
      const res = await app.request(`/api/registry/${kind}`, {
        method: "POST",
        headers: authed,
        body: JSON.stringify(bad),
      });
      expect(res.status).toBe(400);
    }
  });
});

/**
 * The register's durable pull (SPEC §8): a browser whose IndexedDB was cleared
 * re-reads the whole record set on login. Before this route existed, records
 * that had synced up were invisible to any browser but the one that wrote them.
 */
describe("api GET /api/records", () => {
  it("requires a session", async () => {
    const { app } = await make();
    const res = await app.request("/api/records");
    expect(res.status).toBe(401);
  });

  it("lists every synced record body back", async () => {
    const { app, authed } = await make();
    for (const id of ["r1", "r2"]) {
      await app.request("/api/records", {
        method: "POST",
        headers: authed,
        body: JSON.stringify({
          id,
          template_version_id: "pto@1",
          status: "draft",
          updated_at: "2026-08-19T00:00:00.000Z",
          values: { header: {}, rows: {} },
        }),
      });
    }

    const res = await app.request("/api/records", { headers: authed });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { records: Array<Record<string, unknown>> };
    expect(json.records).toHaveLength(2);
    expect(json.records.map((r) => r.id).sort()).toEqual(["r1", "r2"]);
    // The full body comes back, not just the index columns.
    expect(json.records[0]!.values).toEqual({ header: {}, rows: {} });
  });
});
