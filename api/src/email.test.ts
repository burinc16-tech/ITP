import { describe, it, expect, vi } from "vitest";
import { buildSignRequestEmail, ResendEmailSender } from "./email";

describe("buildSignRequestEmail", () => {
  it("includes the role, link, and formatted expiry", () => {
    const msg = buildSignRequestEmail({
      recipientName: "Sam Client",
      role: "Witness",
      url: "https://app.example/sign/abc123",
      expiresAt: "2026-08-09T05:00:00.000Z",
      serialNo: "HLT-001",
    });
    expect(msg.subject).toBe("Signature requested — Witness");
    expect(msg.text).toContain("Hi Sam Client,");
    expect(msg.text).toContain("https://app.example/sign/abc123");
    expect(msg.text).toContain("HLT-001");
    // 05:00 UTC is 13:00 in Asia/Singapore (+08).
    expect(msg.text).toContain("09/08/2026 13:00");
    expect(msg.html).toContain('href="https://app.example/sign/abc123"');
    expect(msg.html).toContain("<strong>Witness</strong>");
  });

  it("falls back to a neutral greeting without a name", () => {
    const msg = buildSignRequestEmail({
      recipientName: null,
      role: "Client",
      url: "https://app.example/sign/x",
      expiresAt: "2026-08-09T05:00:00.000Z",
    });
    expect(msg.text).toContain("Hello,");
    expect(msg.text).not.toContain("undefined");
  });
});

describe("ResendEmailSender", () => {
  it("posts to Resend with the bearer key and message", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true } as Response);
    await new ResendEmailSender("key_123", "from@ex.com", f).send({
      to: "to@ex.com",
      subject: "S",
      html: "<p>h</p>",
      text: "t",
    });
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer key_123");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ from: "from@ex.com", to: ["to@ex.com"], subject: "S" });
  });

  it("throws on a non-ok response", async () => {
    const f = vi.fn().mockResolvedValue({ ok: false, status: 422, text: async () => "bad" } as unknown as Response);
    await expect(
      new ResendEmailSender("k", "f@ex.com", f).send({ to: "t@ex.com", subject: "S", html: "", text: "" }),
    ).rejects.toThrow(/422/);
  });
});
