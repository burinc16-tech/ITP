import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import { MemoryEmailSender, type EmailSender } from "./email";
import {
  MemoryAuditStore,
  MemoryRecordStore,
  MemorySessionStore,
  MemorySignatureImageStore,
  MemorySignatureRequestStore,
  MemorySignatureStore,
  MemoryUserStore,
  type UserRole,
} from "./store";
import { hashToken } from "./token";

const PNG = "data:image/png;base64,iVBORw0KGgo=";
// Bearer for a seeded QA/QC session (issue/revoke require the QA/QC role, task 4).
const authed = { authorization: "Bearer qa-token", "content-type": "application/json" };
const json = { "content-type": "application/json" };

async function seedSession(
  users: MemoryUserStore,
  sessions: MemorySessionStore,
  role: UserRole,
  token: string,
) {
  const id = `u-${role}`;
  await users.create({
    id,
    email: `${role}@x.co`,
    name: role,
    role,
    password_hash: "x",
    created_at: "t",
  });
  await sessions.create({
    id: `s-${token}`,
    user_id: id,
    token_hash: await hashToken(token),
    created_at: "t",
    expires_at: "2999-01-01T00:00:00.000Z",
  });
}

async function harness(now?: () => string, email: EmailSender = new MemoryEmailSender()) {
  const store = new MemoryRecordStore();
  const signRequests = new MemorySignatureRequestStore();
  const signatures = new MemorySignatureStore();
  const audit = new MemoryAuditStore();
  const images = new MemorySignatureImageStore();
  const users = new MemoryUserStore();
  const sessions = new MemorySessionStore();
  await seedSession(users, sessions, "qa_qc", "qa-token");
  await seedSession(users, sessions, "site_engineer", "eng-token");
  const app = createApp({
    store,
    signRequests,
    signatures,
    audit,
    images,
    users,
    sessions,
    email,
    signBaseUrl: "https://sign.example",
    now,
  });
  return { app, store, signRequests, signatures, audit, images, email, users, sessions };
}

async function seedRecord(store: MemoryRecordStore, updated_at = "2026-08-02T01:00:00.000Z") {
  await store.upsert({ id: "r1", template_version_id: "HLT@A", status: "completed", updated_at });
}

async function issue(
  app: Awaited<ReturnType<typeof harness>>["app"],
  over: Record<string, unknown> = {},
) {
  const res = await app.request("/api/records/r1/sign-requests", {
    method: "POST",
    headers: authed,
    body: JSON.stringify({
      slot_id: "sig_witness",
      role: "witness",
      recipient_name: "Sam Client",
      recipient_email: "sam@client.example",
      ...over,
    }),
  });
  return {
    res,
    body: (await res.json()) as {
      id: string;
      token: string;
      url: string;
      expires_at: string;
      emailed: boolean;
    },
  };
}

const actions = (rows: { action: string }[]) => rows.map((r) => r.action);

describe("remote sign-off — issue", () => {
  it("issues a request and returns a tokenized link", async () => {
    const h = await harness();
    await seedRecord(h.store);
    const { res, body } = await issue(h.app);
    expect(res.status).toBe(201);
    expect(body.token).toMatch(/^[0-9a-f]{64}$/);
    expect(body.url).toBe(`https://sign.example/sign/${body.token}`);

    const stored = await h.signRequests.getById(body.id);
    expect(stored?.status).toBe("sent");
    expect(stored?.token_hash).not.toBe(body.token); // hash stored, not the raw token
    expect(actions(await h.audit.listByRecord("r1"))).toContain("issued");
  });

  it("rejects an unauthenticated issue", async () => {
    const h = await harness();
    await seedRecord(h.store);
    const res = await h.app.request("/api/records/r1/sign-requests", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ slot_id: "s", role: "r", recipient_email: "x@y.z" }),
    });
    expect(res.status).toBe(401);
  });

  it("forbids a non-QA/QC user from issuing (403)", async () => {
    const h = await harness();
    await seedRecord(h.store);
    const res = await h.app.request("/api/records/r1/sign-requests", {
      method: "POST",
      headers: { authorization: "Bearer eng-token", "content-type": "application/json" },
      body: JSON.stringify({ slot_id: "sig_witness", role: "witness", recipient_email: "x@y.z" }),
    });
    expect(res.status).toBe(403);
  });

  it("404s issuing against a missing record", async () => {
    const h = await harness();
    const res = await h.app.request("/api/records/nope/sign-requests", {
      method: "POST",
      headers: authed,
      body: JSON.stringify({ slot_id: "s", role: "r", recipient_email: "x@y.z" }),
    });
    expect(res.status).toBe(404);
  });

  it("400s an issue missing required fields", async () => {
    const h = await harness();
    await seedRecord(h.store);
    const res = await h.app.request("/api/records/r1/sign-requests", {
      method: "POST",
      headers: authed,
      body: JSON.stringify({ slot_id: "s" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("remote sign-off — email delivery (task 3)", () => {
  it("emails the link to the recipient and audits it", async () => {
    const mail = new MemoryEmailSender();
    const h = await harness(undefined, mail);
    await seedRecord(h.store);
    const { res, body } = await issue(h.app);

    expect(res.status).toBe(201);
    expect(body.emailed).toBe(true);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.to).toBe("sam@client.example");
    expect(mail.sent[0]!.text).toContain(body.token); // the link (carrying the token) is in the body
    expect(actions(await h.audit.listByRecord("r1"))).toContain("emailed");
  });

  it("still issues (emailed:false) when the sender throws, and audits the failure", async () => {
    const failing: EmailSender = {
      send: () => Promise.reject(new Error("smtp down")),
    };
    const h = await harness(undefined, failing);
    await seedRecord(h.store);
    const { res, body } = await issue(h.app);

    expect(res.status).toBe(201);
    expect(body.emailed).toBe(false);
    // The request is still usable — the link works despite the email failing.
    const open = await h.app.request(`/api/sign/${body.token}`);
    expect(open.status).toBe(200);
    expect(actions(await h.audit.listByRecord("r1"))).toContain("email_failed");
  });
});

describe("remote sign-off — open + sign", () => {
  it("opens the link, then stores a signature in R2 + D1", async () => {
    const h = await harness();
    await seedRecord(h.store);
    const { body } = await issue(h.app);

    const open = await h.app.request(`/api/sign/${body.token}`);
    expect(open.status).toBe(200);
    const opened = (await open.json()) as {
      record: { id: string };
      slot: { slot_id: string; role: string };
      recipient: { email: string };
    };
    expect(opened.record.id).toBe("r1");
    expect(opened.slot).toEqual({ slot_id: "sig_witness", role: "witness" });
    expect(opened.recipient.email).toBe("sam@client.example");
    expect((await h.signRequests.getById(body.id))?.status).toBe("opened");

    const sign = await h.app.request(`/api/sign/${body.token}`, {
      method: "POST",
      headers: { ...json, "cf-connecting-ip": "203.0.113.9" },
      body: JSON.stringify({ image: PNG, company: "Client Co" }),
    });
    expect(sign.status).toBe(200);
    expect(await sign.json()).toEqual({ ok: true });

    const sigs = await h.signatures.listByRecord("r1");
    expect(sigs).toHaveLength(1);
    // Deterministic id = the request id, so a concurrent double-submit dedupes
    // via insert-once instead of writing a second row (§12).
    expect(sigs[0]!.id).toBe(body.id);
    expect(sigs[0]).toMatchObject({
      slot_id: "sig_witness",
      role: "witness",
      method: "remote_link",
      name: "Sam Client",
      company: "Client Co",
      device_id: "remote",
      signer_email: "sam@client.example",
      signer_ip: "203.0.113.9",
    });
    expect(await h.images.get(sigs[0]!.image_key)).not.toBeNull();
    expect((await h.signRequests.getById(body.id))?.status).toBe("signed");
    expect(actions(await h.audit.listByRecord("r1"))).toEqual(
      expect.arrayContaining(["issued", "opened", "signed"]),
    );
  });

  it("dedupes a double-submit of one token into a single signature row", async () => {
    const h = await harness();
    await seedRecord(h.store);
    const { body } = await issue(h.app);

    const sign = () =>
      h.app.request(`/api/sign/${body.token}`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ image: PNG, name: "Sam Client" }),
      });

    const first = await sign();
    expect(first.status).toBe(200);

    // Simulate the concurrent race: both submits pass resolve() while the request
    // is still "opened". Reset it and submit again — the deterministic signature id
    // (= request id) makes insert-once drop the duplicate.
    const req = (await h.signRequests.getById(body.id))!;
    await h.signRequests.update({ ...req, status: "opened", closed_at: null });
    const second = await sign();
    expect(second.status).toBe(200);

    expect(await h.signatures.listByRecord("r1")).toHaveLength(1);
  });

  it("400s a sign with no image", async () => {
    const h = await harness();
    await seedRecord(h.store);
    const { body } = await issue(h.app);
    const res = await h.app.request(`/api/sign/${body.token}`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("is single-use — a second sign is 409", async () => {
    const h = await harness();
    await seedRecord(h.store);
    const { body } = await issue(h.app);
    await h.app.request(`/api/sign/${body.token}`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ image: PNG }),
    });
    const again = await h.app.request(`/api/sign/${body.token}`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ image: PNG }),
    });
    expect(again.status).toBe(409);
    expect((await again.json()) as { error: string }).toMatchObject({ error: "closed" });
    expect(await h.signatures.listByRecord("r1")).toHaveLength(1);
  });
});

describe("remote sign-off — reject", () => {
  it("rejects, flips the record to rejected, and closes the link", async () => {
    const h = await harness();
    await seedRecord(h.store);
    const { body } = await issue(h.app);
    await h.app.request(`/api/sign/${body.token}`); // open

    const rej = await h.app.request(`/api/sign/${body.token}/reject`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ reason: "Panel label wrong" }),
    });
    expect(rej.status).toBe(200);

    expect((await h.store.get("r1"))?.status).toBe("rejected");
    const req = await h.signRequests.getById(body.id);
    expect(req?.status).toBe("rejected");
    expect(req?.reject_reason).toBe("Panel label wrong");
    expect(actions(await h.audit.listByRecord("r1"))).toContain("rejected");

    const reopen = await h.app.request(`/api/sign/${body.token}`);
    expect(reopen.status).toBe(409);
  });

  it("400s a reject with no reason", async () => {
    const h = await harness();
    await seedRecord(h.store);
    const { body } = await issue(h.app);
    const res = await h.app.request(`/api/sign/${body.token}/reject`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ reason: "  " }),
    });
    expect(res.status).toBe(400);
  });
});

describe("remote sign-off — freeze, expiry, tokens", () => {
  it("voids the link when the record changed since issue (409)", async () => {
    const h = await harness();
    await seedRecord(h.store, "2026-08-02T01:00:00.000Z");
    const { body } = await issue(h.app);

    // Record edited after the link went out.
    await h.store.upsert({
      id: "r1",
      template_version_id: "HLT@A",
      status: "completed",
      updated_at: "2026-08-02T09:00:00.000Z",
    });

    const open = await h.app.request(`/api/sign/${body.token}`);
    expect(open.status).toBe(409);
    expect((await open.json()) as { error: string }).toMatchObject({ error: "version_mismatch" });
    expect((await h.signRequests.getById(body.id))?.status).toBe("sent"); // not opened
  });

  it("lazily expires past the deadline and audits it once", async () => {
    let clock = "2026-08-02T00:00:00.000Z";
    const h = await harness(() => clock);
    await seedRecord(h.store, "2026-08-02T00:00:00.000Z");
    const { body } = await issue(h.app);

    clock = "2026-08-20T00:00:00.000Z"; // well past +7d
    const first = await h.app.request(`/api/sign/${body.token}`);
    expect(first.status).toBe(410);
    expect((await first.json()) as { error: string }).toMatchObject({ error: "expired" });

    const second = await h.app.request(`/api/sign/${body.token}`);
    expect(second.status).toBe(410);

    const expiredAudits = (await h.audit.listByRecord("r1")).filter((a) => a.action === "expired");
    expect(expiredAudits).toHaveLength(1);
  });

  it("404s an unknown token", async () => {
    const h = await harness();
    const res = await h.app.request("/api/sign/deadbeef");
    expect(res.status).toBe(404);
  });
});

describe("remote sign-off — revoke", () => {
  it("revokes an outstanding request and closes the link", async () => {
    const h = await harness();
    await seedRecord(h.store);
    const { body } = await issue(h.app);

    const rev = await h.app.request(`/api/sign-requests/${body.id}/revoke`, {
      method: "POST",
      headers: authed,
    });
    expect(rev.status).toBe(200);
    expect((await h.signRequests.getById(body.id))?.status).toBe("revoked");
    expect(actions(await h.audit.listByRecord("r1"))).toContain("revoked");

    const open = await h.app.request(`/api/sign/${body.token}`);
    expect(open.status).toBe(409);
  });

  it("409s revoking an already-closed request and 404s an unknown one", async () => {
    const h = await harness();
    await seedRecord(h.store);
    const { body } = await issue(h.app);
    await h.app.request(`/api/sign-requests/${body.id}/revoke`, { method: "POST", headers: authed });
    const again = await h.app.request(`/api/sign-requests/${body.id}/revoke`, {
      method: "POST",
      headers: authed,
    });
    expect(again.status).toBe(409);

    const unknown = await h.app.request("/api/sign-requests/nope/revoke", {
      method: "POST",
      headers: authed,
    });
    expect(unknown.status).toBe(404);
  });

  it("rejects an unauthenticated revoke", async () => {
    const h = await harness();
    await seedRecord(h.store);
    const { body } = await issue(h.app);
    const res = await h.app.request(`/api/sign-requests/${body.id}/revoke`, { method: "POST" });
    expect(res.status).toBe(401);
  });
});
