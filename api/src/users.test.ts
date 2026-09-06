import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import { MemoryRecordStore, MemorySessionStore, MemoryUserStore } from "./store";
import { hashToken } from "./token";

async function make() {
  const users = new MemoryUserStore();
  const sessions = new MemorySessionStore();
  for (const [id, name, role] of [
    ["u2", "Zed Tan", "site_engineer"],
    ["u1", "Amy Lim", "qa_qc"],
  ] as const) {
    await users.create({
      id,
      email: `${id}@site.co`,
      name,
      role,
      password_hash: "pbkdf2$secret",
      created_at: "t",
    });
  }
  await sessions.create({
    id: "s1",
    user_id: "u1",
    token_hash: await hashToken("tok"),
    created_at: "t",
    expires_at: "2999-01-01T00:00:00.000Z",
  });
  const app = createApp({ store: new MemoryRecordStore(), users, sessions });
  return { app };
}

/**
 * The user directory behind the register's BY column: records store only the
 * creator's id, so the client needs id → name for everyone, not just itself.
 */
describe("api GET /api/users", () => {
  it("requires a session", async () => {
    const { app } = await make();
    expect((await app.request("/api/users")).status).toBe(401);
  });

  it("lists every user by name with only id, name and role", async () => {
    const { app } = await make();
    const res = await app.request("/api/users", { headers: { authorization: "Bearer tok" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { users: Record<string, unknown>[] };
    expect(body.users).toEqual([
      { id: "u1", name: "Amy Lim", role: "qa_qc" },
      { id: "u2", name: "Zed Tan", role: "site_engineer" },
    ]);
    for (const u of body.users) {
      expect(u).not.toHaveProperty("email");
      expect(u).not.toHaveProperty("password_hash");
    }
  });
});
