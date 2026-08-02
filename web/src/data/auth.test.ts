import { describe, it, expect, vi } from "vitest";
import { AuthClient } from "./auth";

const R = (status: number, body: unknown = {}): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

describe("AuthClient", () => {
  it("login returns the session on 200", async () => {
    const session = {
      token: "abc",
      expires_at: "t",
      user: { id: "u1", email: "a@b.co", name: "A", role: "qa_qc" },
    };
    const f = vi.fn().mockResolvedValue(R(200, session));
    const out = await new AuthClient("http://api/", f).login("a@b.co", "pw");
    expect(out).toEqual(session);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api/api/auth/login");
    expect(JSON.parse(init.body as string)).toEqual({ email: "a@b.co", password: "pw" });
  });

  it("login throws a friendly message on 401", async () => {
    const f = vi.fn().mockResolvedValue(R(401, { error: "invalid credentials" }));
    await expect(new AuthClient("http://api", f).login("a@b.co", "bad")).rejects.toThrow(
      /Incorrect email or password/,
    );
  });

  it("me returns the user on 200 and null on 401", async () => {
    const user = { id: "u1", email: "a@b.co", name: "A", role: "qa_qc" };
    const ok = new AuthClient("http://api", vi.fn().mockResolvedValue(R(200, { user })));
    expect(await ok.me("tok")).toEqual(user);
    const bad = new AuthClient("http://api", vi.fn().mockResolvedValue(R(401)));
    expect(await bad.me("tok")).toBeNull();
  });

  it("me sends the bearer token", async () => {
    const f = vi.fn().mockResolvedValue(R(200, { user: {} }));
    await new AuthClient("http://api", f).me("tok");
    const init = f.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });
});
