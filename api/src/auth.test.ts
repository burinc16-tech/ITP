import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import { hashPassword, verifyPassword } from "./auth";
import { MemoryRecordStore, MemorySessionStore, MemoryUserStore } from "./store";

describe("password hashing", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const stored = await hashPassword("correct horse");
    expect(stored.startsWith("pbkdf2$")).toBe(true);
    expect(await verifyPassword("correct horse", stored)).toBe(true);
    expect(await verifyPassword("wrong", stored)).toBe(false);
  });

  it("salts — two hashes of the same password differ", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same", a)).toBe(true);
    expect(await verifyPassword("same", b)).toBe(true);
  });

  it("rejects a malformed stored hash", async () => {
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
  });
});

async function appWithUser(role: "site_engineer" | "qa_qc" = "qa_qc") {
  const users = new MemoryUserStore();
  const sessions = new MemorySessionStore();
  await users.create({
    id: "u1",
    email: "Jo@Site.co", // mixed case — login should be case-insensitive
    name: "Jo Lee",
    role,
    password_hash: await hashPassword("s3cret"),
    created_at: "t",
  });
  const app = createApp({ store: new MemoryRecordStore(), users, sessions });
  return { app, sessions };
}

const json = { "content-type": "application/json" };

async function login(app: Awaited<ReturnType<typeof appWithUser>>["app"], email: string, password: string) {
  const res = await app.request("/api/auth/login", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ email, password }),
  });
  return res;
}

describe("auth endpoints", () => {
  it("logs in with valid credentials (case-insensitive email) and returns a session + user", async () => {
    const { app } = await appWithUser();
    const res = await login(app, "jo@site.co", "s3cret");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      token: string;
      user: { email: string; role: string; password_hash?: string };
    };
    expect(body.token).toMatch(/^[0-9a-f]{64}$/);
    expect(body.user.email).toBe("jo@site.co");
    expect(body.user.role).toBe("qa_qc");
    expect(body.user.password_hash).toBeUndefined(); // never leak the hash
  });

  it("rejects a wrong password and an unknown email with 401", async () => {
    const { app } = await appWithUser();
    expect((await login(app, "jo@site.co", "nope")).status).toBe(401);
    expect((await login(app, "ghost@site.co", "s3cret")).status).toBe(401);
  });

  it("me returns the user for a valid session and 401 without one", async () => {
    const { app } = await appWithUser();
    const token = ((await (await login(app, "jo@site.co", "s3cret")).json()) as { token: string })
      .token;

    const me = await app.request("/api/auth/me", { headers: { authorization: `Bearer ${token}` } });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { user: { email: string } }).user.email).toBe("jo@site.co");

    const anon = await app.request("/api/auth/me");
    expect(anon.status).toBe(401);
  });

  it("logout invalidates the session token", async () => {
    const { app } = await appWithUser();
    const token = ((await (await login(app, "jo@site.co", "s3cret")).json()) as { token: string })
      .token;
    const auth = { authorization: `Bearer ${token}` };

    const out = await app.request("/api/auth/logout", { method: "POST", headers: auth });
    expect(out.status).toBe(200);

    const me = await app.request("/api/auth/me", { headers: auth });
    expect(me.status).toBe(401); // token no longer valid
  });

  it("treats an expired session as unauthorized", async () => {
    const users = new MemoryUserStore();
    const sessions = new MemorySessionStore();
    await users.create({
      id: "u1",
      email: "a@b.co",
      name: "A",
      role: "qa_qc",
      password_hash: "x",
      created_at: "t",
    });
    // Session already expired relative to the injected clock.
    const app = createApp({
      store: new MemoryRecordStore(),
      users,
      sessions,
      now: () => "2026-08-10T00:00:00.000Z",
    });
    const { hashToken } = await import("./token");
    await sessions.create({
      id: "s1",
      user_id: "u1",
      token_hash: await hashToken("stale"),
      created_at: "t",
      expires_at: "2026-08-01T00:00:00.000Z",
    });
    const me = await app.request("/api/auth/me", { headers: { authorization: "Bearer stale" } });
    expect(me.status).toBe(401);
  });
});
