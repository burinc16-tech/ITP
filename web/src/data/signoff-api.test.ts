import { describe, it, expect, vi } from "vitest";
import {
  openSignLink,
  rejectSignLink,
  submitSignature,
  SignoffClient,
} from "./signoff-api";

/** A minimal Response stand-in — the client only reads ok/status/json(). */
const R = (status: number, body: unknown = {}): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

describe("signoff-api — public endpoints", () => {
  it("openSignLink returns the view on 200", async () => {
    const view = {
      record: { id: "r1" },
      slot: { slot_id: "s", role: "witness" },
      recipient: { name: null, email: "a@b.c" },
      expires_at: "t",
      status: "opened",
    };
    const f = vi.fn().mockResolvedValue(R(200, view));
    const res = await openSignLink("http://api/", "tok", f);
    expect(res).toEqual({ ok: true, view });
    expect(f).toHaveBeenCalledWith("http://api/api/sign/tok");
  });

  it("maps status codes to error kinds", async () => {
    const cases: Array<[number, unknown, string]> = [
      [404, {}, "unknown"],
      [410, {}, "expired"],
      [409, { error: "version_mismatch" }, "version_mismatch"],
      [409, { error: "closed" }, "closed"],
      [500, {}, "error"],
    ];
    for (const [status, body, kind] of cases) {
      const res = await openSignLink("http://api", "tok", vi.fn().mockResolvedValue(R(status, body)));
      expect(res).toEqual({ ok: false, kind });
    }
  });

  it("openSignLink returns error on a network throw", async () => {
    const res = await openSignLink("http://api", "tok", vi.fn().mockRejectedValue(new Error("net")));
    expect(res).toEqual({ ok: false, kind: "error" });
  });

  it("submitSignature posts the image and returns ok", async () => {
    const f = vi.fn().mockResolvedValue(R(200, { ok: true }));
    const res = await submitSignature("http://api", "tok", { image: "data:img", name: "N" }, f);
    expect(res).toEqual({ ok: true });
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api/api/sign/tok");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string).image).toBe("data:img");
  });

  it("submitSignature maps a 409 version_mismatch", async () => {
    const res = await submitSignature(
      "http://api",
      "tok",
      { image: "x" },
      vi.fn().mockResolvedValue(R(409, { error: "version_mismatch" })),
    );
    expect(res).toEqual({ ok: false, kind: "version_mismatch" });
  });

  it("rejectSignLink posts the reason", async () => {
    const f = vi.fn().mockResolvedValue(R(200, { ok: true }));
    const res = await rejectSignLink("http://api", "tok", "because", f);
    expect(res).toEqual({ ok: true });
    const init = f.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(init.body as string).reason).toBe("because");
  });
});

describe("signoff-api — SignoffClient (privileged)", () => {
  it("issue posts with the bearer secret and returns the request", async () => {
    const issued = { id: "req1", token: "tk", url: "http://web/sign/tk", expires_at: "t" };
    const f = vi.fn().mockResolvedValue(R(201, issued));
    const client = new SignoffClient("http://api", "secret", f);
    const out = await client.issue("r1", { slot_id: "s", role: "witness", recipient_email: "a@b.c" });
    expect(out).toEqual(issued);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api/api/records/r1/sign-requests");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer secret");
  });

  it("issue throws the server error message", async () => {
    const f = vi.fn().mockResolvedValue(R(404, { error: "not found" }));
    const client = new SignoffClient("http://api", "secret", f);
    await expect(
      client.issue("r1", { slot_id: "s", role: "r", recipient_email: "a@b.c" }),
    ).rejects.toThrow("not found");
  });
});
