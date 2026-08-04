import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import {
  MemoryAttachmentStore,
  MemoryRecordStore,
  MemorySessionStore,
  MemorySignatureImageStore,
  MemoryUserStore,
} from "./store";
import { hashToken } from "./token";

/** An image store that counts writes, to prove a caption-only re-push skips R2. */
class CountingImages extends MemorySignatureImageStore {
  puts = 0;
  async put(key: string, data: Uint8Array, contentType: string): Promise<void> {
    this.puts += 1;
    await super.put(key, data, contentType);
  }
}

async function make() {
  const store = new MemoryRecordStore();
  const users = new MemoryUserStore();
  const sessions = new MemorySessionStore();
  const attachments = new MemoryAttachmentStore();
  const images = new CountingImages();
  await store.upsert({ id: "r1", template_version_id: "IDF@A", status: "draft", updated_at: "t" });
  await users.create({ id: "u1", email: "e@s.co", name: "E", role: "site_engineer", password_hash: "x", created_at: "t" });
  await sessions.create({ id: "s1", user_id: "u1", token_hash: await hashToken("tok"), created_at: "t", expires_at: "2999-01-01T00:00:00.000Z" });
  const app = createApp({ store, users, sessions, attachments, images });
  const authed = { authorization: "Bearer tok", "content-type": "application/json" };
  return { app, authed, attachments, images };
}

const body = (over: Record<string, unknown> = {}) => ({
  id: "at1",
  field_id: "chk_3_1:photo",
  caption: "north wall",
  device_id: "d",
  created_at: "2026-08-04T00:00:00.000Z",
  image: "data:image/jpeg;base64,AQID", // bytes [1,2,3]
  ...over,
});

describe("api /api/records/:id/attachments", () => {
  it("rejects without a session", async () => {
    const { app } = await make();
    const res = await app.request("/api/records/r1/attachments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body()),
    });
    expect(res.status).toBe(401);
  });

  it("404s when the record is unknown", async () => {
    const { app, authed } = await make();
    const res = await app.request("/api/records/ghost/attachments", {
      method: "POST",
      headers: authed,
      body: JSON.stringify(body()),
    });
    expect(res.status).toBe(404);
  });

  it("stores the image and metadata", async () => {
    const { app, authed, attachments, images } = await make();
    const res = await app.request("/api/records/r1/attachments", {
      method: "POST",
      headers: authed,
      body: JSON.stringify(body()),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ applied: true });
    const row = await attachments.getById("at1");
    expect(row?.field_id).toBe("chk_3_1:photo");
    expect(row?.caption).toBe("north wall");
    expect(await images.get(row!.image_key)).toEqual(new Uint8Array([1, 2, 3]));
    expect(images.puts).toBe(1);
  });

  it("upserts a caption without rewriting the R2 blob", async () => {
    const { app, authed, attachments, images } = await make();
    await app.request("/api/records/r1/attachments", { method: "POST", headers: authed, body: JSON.stringify(body()) });
    const res = await app.request("/api/records/r1/attachments", {
      method: "POST",
      headers: authed,
      body: JSON.stringify(body({ caption: "north wall — cracked" })),
    });
    expect(res.status).toBe(200);
    expect((await attachments.getById("at1"))?.caption).toBe("north wall — cracked");
    expect(images.puts).toBe(1); // same bytes → blob not rewritten
  });

  it("400s when the image is missing", async () => {
    const { app, authed } = await make();
    const res = await app.request("/api/records/r1/attachments", {
      method: "POST",
      headers: authed,
      body: JSON.stringify(body({ image: "" })),
    });
    expect(res.status).toBe(400);
  });
});
