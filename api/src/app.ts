import { Hono } from "hono";
import { cors } from "hono/cors";
import type { MiddlewareHandler } from "hono";
import type {
  AttachmentRow,
  AttachmentStore,
  AuditRow,
  AuditStore,
  EquipmentRow,
  IncomingRecord,
  InstrumentRow,
  InstrumentStore,
  ProjectRow,
  RecordStore,
  RegistryStore,
  SessionStore,
  SignatureImageStore,
  SignatureRequest,
  SignatureRequestStore,
  SignatureRow,
  SignatureStore,
  SystemRow,
  UserRole,
  UserStore,
} from "./store";
import {
  CLOSED_REQUEST_STATUSES,
  MemoryAttachmentStore,
  MemoryAuditStore,
  MemoryInstrumentStore,
  MemoryRegistryStore,
  MemorySessionStore,
  MemorySignatureImageStore,
  MemorySignatureRequestStore,
  MemorySignatureStore,
  MemoryUserStore,
} from "./store";
import { decodeImage, deterministicId, generateToken, hashToken } from "./token";
import { uuidv7 } from "./uuidv7";
import { buildSignRequestEmail, MemoryEmailSender, type EmailSender } from "./email";
import { verifyPassword } from "./auth";

/** The authenticated user attached to a request by the session middleware. */
interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

/**
 * The API (SPEC §3, Hono on Cloudflare Workers). Handles record sync, the server
 * side of remote sign-off (§6 path B), transactional email, and real
 * email/password auth. Built via a factory so it runs against in-memory stores in
 * tests and D1/R2 in production.
 *
 * Privileged endpoints require a valid bearer SESSION obtained from
 * `POST /api/auth/login` (task 4, replacing the earlier shared secret); issuing
 * and revoking sign-off links additionally require the QA/QC role (§9). The public
 * `/api/sign/:token` endpoints stay open, guarded by the single-use token instead.
 */

const ROLE_QA: UserRole = "qa_qc";
const EXPIRY_DAYS = 7;
const SESSION_DAYS = 30;

/**
 * Insert-once tamper tripwire (SPEC §12): the content identity of an evidence
 * row under a given id. A replay carries the same fingerprint (no-op); a same-id
 * write whose fingerprint differs is an evidence conflict, never an overwrite.
 * Signature image bytes are compared separately (they live in R2, not the row).
 */
function signatureFingerprint(s: SignatureRow): string {
  return JSON.stringify([
    s.record_id, s.slot_id, s.role, s.name, s.company, s.method,
    s.signed_by_user, s.device_id, s.signed_at, s.signer_email, s.signer_ip,
  ]);
}

function auditFingerprint(e: AuditRow): string {
  return JSON.stringify([
    e.record_id, e.user, e.role, e.action, e.before, e.after, e.reason, e.at,
  ]);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Sniff an image content type from its magic bytes (PNG vs JPEG). */
function imageContentType(bytes: Uint8Array): string {
  return bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 ? "image/png" : "image/jpeg";
}

export interface AppDeps {
  store: RecordStore;
  /** Sign-off stores; default to in-memory fakes so record-only tests need not pass them. */
  signRequests?: SignatureRequestStore;
  signatures?: SignatureStore;
  audit?: AuditStore;
  images?: SignatureImageStore;
  /** Photo attachment metadata store (§8); image bytes reuse `images` (R2). */
  attachments?: AttachmentStore;
  /** Calibration register (§10 screen 9) — shared reference data, not per-record. */
  instruments?: InstrumentStore;
  /** Project registry (§4, §10 screen 8) — shared reference data, like instruments. */
  registry?: RegistryStore;
  /** Auth stores (task 4). Default to in-memory fakes; seed a user to log in. */
  users?: UserStore;
  sessions?: SessionStore;
  /** Delivers the signing link. Defaults to an in-memory fake (nothing sent). */
  email?: EmailSender;
  /** Injectable clock/ids/token for deterministic tests. */
  now?: () => string;
  newId?: () => string;
  generateToken?: () => string;
  /** Base URL of the public /sign/:token page (web app). Falls back to the request origin. */
  signBaseUrl?: string;
}

export function createApp(deps: AppDeps) {
  const app = new Hono<{ Variables: { user: AuthUser } }>();
  app.use("/api/*", cors());

  const store = deps.store;
  const signRequests = deps.signRequests ?? new MemorySignatureRequestStore();
  const signatures = deps.signatures ?? new MemorySignatureStore();
  const audit = deps.audit ?? new MemoryAuditStore();
  const images = deps.images ?? new MemorySignatureImageStore();
  const attachments = deps.attachments ?? new MemoryAttachmentStore();
  const instruments = deps.instruments ?? new MemoryInstrumentStore();
  const registry = deps.registry ?? new MemoryRegistryStore();
  const users = deps.users ?? new MemoryUserStore();
  const sessions = deps.sessions ?? new MemorySessionStore();
  const email = deps.email ?? new MemoryEmailSender();
  const now = deps.now ?? (() => new Date().toISOString());
  // UUIDv7 for every server-minted id (SPEC §4, Hard Rule #2) — never v4/sequence.
  const newId = deps.newId ?? uuidv7;
  const genToken = deps.generateToken ?? generateToken;

  const bearer = (c: { req: { header: (n: string) => string | undefined } }): string | null => {
    const auth = c.req.header("authorization");
    return auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  };

  /** Resolve the user for a request's bearer session, or null. Expiry is lazy. */
  async function currentUser(token: string | null): Promise<AuthUser | null> {
    if (!token) return null;
    const session = await sessions.getByTokenHash(await hashToken(token));
    if (!session) return null;
    if (now() > session.expires_at) {
      await sessions.deleteByTokenHash(session.token_hash);
      return null;
    }
    const user = await users.getById(session.user_id);
    return user ? { id: user.id, email: user.email, name: user.name, role: user.role } : null;
  }

  /** Require a valid session; attaches the user to the context. */
  const requireUser: MiddlewareHandler<{ Variables: { user: AuthUser } }> = async (c, next) => {
    const user = await currentUser(bearer(c));
    if (!user) return c.json({ error: "unauthorized" }, 401);
    c.set("user", user);
    await next();
  };

  /** Require a specific role. Runs after requireUser (reads the attached user). */
  const requireRole =
    (role: UserRole): MiddlewareHandler<{ Variables: { user: AuthUser } }> =>
    async (c, next) => {
      if (c.get("user").role !== role) return c.json({ error: "forbidden" }, 403);
      await next();
    };

  async function writeAudit(
    recordId: string,
    role: string,
    action: string,
    extra: {
      reason?: string | null;
      after?: string | null;
      user?: string | null;
      /** Deterministic id for a once-per-request lifecycle event (§9/§12), so a
       *  concurrent double-submit dedupes instead of logging the event twice. */
      id?: string;
    } = {},
  ): Promise<void> {
    const entry: AuditRow = {
      id: extra.id ?? newId(),
      record_id: recordId,
      user: extra.user ?? null,
      role,
      action,
      before: null,
      after: extra.after ?? null,
      reason: extra.reason ?? null,
      at: now(),
    };
    await audit.add(entry);
  }

  // --- Auth (SPEC §3, task 4) ----------------------------------------------

  const publicUser = (u: AuthUser) => ({ id: u.id, email: u.email, name: u.name, role: u.role });

  app.post("/api/auth/login", async (c) => {
    let body: { email?: string; password?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    if (!body.email || !body.password) {
      return c.json({ error: "email and password are required" }, 400);
    }
    const user = await users.getByEmail(body.email);
    // Verify even when the user is missing to avoid leaking which emails exist.
    const ok = user
      ? await verifyPassword(body.password, user.password_hash)
      : await verifyPassword(body.password, "pbkdf2$1$AA$AA").then(() => false);
    if (!user || !ok) return c.json({ error: "invalid credentials" }, 401);

    const token = genToken();
    const issuedAt = now();
    const expiresAt = new Date(new Date(issuedAt).getTime() + SESSION_DAYS * 86_400_000).toISOString();
    await sessions.create({
      id: newId(),
      user_id: user.id,
      token_hash: await hashToken(token),
      created_at: issuedAt,
      expires_at: expiresAt,
    });
    return c.json({ token, expires_at: expiresAt, user: publicUser(user) });
  });

  app.post("/api/auth/logout", requireUser, async (c) => {
    const token = bearer(c);
    if (token) await sessions.deleteByTokenHash(await hashToken(token));
    return c.json({ ok: true });
  });

  app.get("/api/auth/me", requireUser, (c) => c.json({ user: publicUser(c.get("user")) }));

  app.get("/api/health", (c) => c.json({ ok: true }));

  // --- Record sync (task 1) ------------------------------------------------

  app.post("/api/records", requireUser, async (c) => {
    let record: IncomingRecord;
    try {
      record = await c.req.json<IncomingRecord>();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    if (!record?.id || !record?.updated_at || !record?.template_version_id) {
      return c.json({ error: "invalid record" }, 400);
    }
    // A soft-delete tombstone (Hard Rule #6 guard, mirroring the client): only a
    // draft/completed record with no signatures may be deleted. 409 is terminal
    // for the sync queue — replaying the same refused delete never succeeds.
    // Locked statuses (accepted/rejected) are already refused by store.upsert.
    if (record.deleted === true) {
      const existing = await store.get(record.id);
      if (existing && existing.status !== "draft" && existing.status !== "completed") {
        return c.json({ error: "only a draft or completed record can be deleted" }, 409);
      }
      if ((await signatures.listByRecord(record.id)).length > 0) {
        return c.json({ error: "record has signatures; signed evidence is never deleted" }, 409);
      }
    }
    const result = await store.upsert(record);
    return c.json(result);
  });

  // The register's durable pull (SPEC §8): every record body, so a browser whose
  // IndexedDB was cleared can rebuild its local store on login instead of showing
  // an empty register for records that synced up long ago. Registered before the
  // :id route so "records" is never captured as an id.
  app.get("/api/records", requireUser, async (c) => {
    return c.json({ records: await store.list() });
  });

  app.get("/api/records/:id", requireUser, async (c) => {
    const record = await store.get(c.req.param("id"));
    if (!record) return c.json({ error: "not found" }, 404);
    return c.json(record);
  });

  // --- Project registry (SPEC §4, §10 screen 8) -----------------------------
  // Shared reference data like the calibration register: upsert by client id,
  // last-write-wins on `updated_at`. Before these routes existed the registry
  // had no server copy at all — a cleared browser lost every project, system,
  // and equipment tag, and nothing could restore them.

  app.get("/api/registry", requireUser, async (c) => {
    return c.json(await registry.list());
  });

  app.post("/api/registry/projects", requireUser, async (c) => {
    let body: Partial<ProjectRow>;
    try {
      body = await c.req.json<Partial<ProjectRow>>();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    if (!body?.id || !body?.updated_at) return c.json({ error: "invalid project" }, 400);
    await registry.upsertProject({
      id: body.id,
      code: body.code ?? "",
      name: body.name ?? "",
      client: body.client ?? "",
      status: body.status ?? "open",
      created_at: body.created_at ?? "",
      closed_at: body.closed_at ?? null,
      updated_at: body.updated_at,
    });
    return c.json({ applied: true });
  });

  app.post("/api/registry/systems", requireUser, async (c) => {
    let body: Partial<SystemRow>;
    try {
      body = await c.req.json<Partial<SystemRow>>();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    if (!body?.id || !body?.updated_at || !body?.project_id) {
      return c.json({ error: "invalid system" }, 400);
    }
    await registry.upsertSystem({
      id: body.id,
      project_id: body.project_id,
      name: body.name ?? "",
      code: body.code ?? "",
      parent_system_id: body.parent_system_id ?? null,
      updated_at: body.updated_at,
    });
    return c.json({ applied: true });
  });

  app.post("/api/registry/equipment", requireUser, async (c) => {
    let body: Partial<EquipmentRow>;
    try {
      body = await c.req.json<Partial<EquipmentRow>>();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    if (!body?.id || !body?.updated_at || !body?.project_id || !body?.system_id) {
      return c.json({ error: "invalid equipment" }, 400);
    }
    await registry.upsertEquipment({
      id: body.id,
      project_id: body.project_id,
      system_id: body.system_id,
      tag: body.tag ?? "",
      description: body.description ?? "",
      location: body.location ?? "",
      drawing_ref: body.drawing_ref ?? "",
      updated_at: body.updated_at,
    });
    return c.json({ applied: true });
  });

  // --- Calibration register (SPEC §4, §10 screen 9) ------------------------
  // Shared reference data, so unlike every other sync route these are not nested
  // under a record. Upsert by client id, last-write-wins on `updated_at`; deletes
  // travel as tombstones (`deleted: 1`) because a hard delete on one device would
  // otherwise be undone by the next push from a device that still held the row.

  app.get("/api/instruments", requireUser, async (c) => {
    // Tombstones are included deliberately: the client needs them to apply a
    // delete made on another device.
    return c.json({ instruments: await instruments.list() });
  });

  app.post("/api/instruments", requireUser, async (c) => {
    let body: Partial<InstrumentRow>;
    try {
      body = await c.req.json<Partial<InstrumentRow>>();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    if (!body?.id || !body?.updated_at) {
      return c.json({ error: "invalid instrument" }, 400);
    }
    const row: InstrumentRow = {
      id: body.id,
      serial_no: body.serial_no ?? "",
      description: body.description ?? "",
      cal_cert_url: body.cal_cert_url ?? "",
      // An older client pushes no `cert_no`; a blank is a valid register row, so
      // the write is accepted rather than rejected as invalid.
      cert_no: body.cert_no ?? "",
      cal_date: body.cal_date ?? "",
      cal_due_date: body.cal_due_date ?? "",
      updated_at: body.updated_at,
      deleted: body.deleted ? 1 : 0,
    };
    await instruments.upsert(row);
    return c.json({ applied: true });
  });

  // --- Sync push: append-only evidence (SPEC §8, §12) ----------------------
  // On-device signatures and client-authored audit entries. Insert-once: an
  // identical replay returns { applied: false }; a same-id write whose content
  // differs is an evidence conflict (409), never an overwrite (Hard Rule #6).

  app.post("/api/records/:id/signatures", requireUser, async (c) => {
    const recordId = c.req.param("id");
    if (!(await store.get(recordId))) return c.json({ error: "not found" }, 404);

    let body: {
      id?: string; slot_id?: string; role?: string; name?: string; company?: string;
      method?: string; signed_by_user?: string | null; device_id?: string;
      signed_at?: string; image?: string;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    if (!body.id || !body.slot_id || !body.role || !body.method || !body.device_id || !body.signed_at) {
      return c.json({ error: "invalid signature" }, 400);
    }
    let bytes: Uint8Array;
    let contentType: string;
    try {
      ({ bytes, contentType } = decodeImage(body.image ?? ""));
    } catch {
      return c.json({ error: "a signature image is required" }, 400);
    }

    const imageKey = `signatures/${recordId}/${body.id}.png`;
    const row: SignatureRow = {
      id: body.id,
      record_id: recordId,
      slot_id: body.slot_id,
      role: body.role,
      name: body.name ?? "",
      company: body.company ?? "",
      method: body.method,
      signed_by_user: body.signed_by_user ?? null,
      device_id: body.device_id,
      image_key: imageKey,
      signed_at: body.signed_at,
      signer_email: null,
      signer_ip: null,
    };

    const existing = await signatures.getById(body.id);
    if (existing) {
      const stored = await images.get(existing.image_key);
      const identical =
        signatureFingerprint(existing) === signatureFingerprint(row) &&
        !!stored &&
        bytesEqual(stored, bytes);
      if (!identical) return c.json({ error: "evidence_conflict" }, 409);
      return c.json({ applied: false }); // insert-once no-op
    }

    await images.put(imageKey, bytes, contentType);
    await signatures.add(row);
    return c.json({ applied: true }, 201);
  });

  // --- Sync push: photo attachments (SPEC §4, §8) --------------------------
  // Upsert by client id (last-write-wins), so a recaption re-pushes the row. The
  // image bytes reuse the R2 store; the blob is only rewritten when it actually
  // changes, making a caption-only re-push cheap. Photos are editable draft data,
  // not append-only evidence, so this is an upsert — not the signature insert-once.

  app.post("/api/records/:id/attachments", requireUser, async (c) => {
    const recordId = c.req.param("id");
    if (!(await store.get(recordId))) return c.json({ error: "not found" }, 404);

    let body: {
      id?: string; field_id?: string; caption?: string;
      device_id?: string; created_at?: string; image?: string;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    if (!body.id || !body.field_id || !body.device_id || !body.created_at) {
      return c.json({ error: "invalid attachment" }, 400);
    }
    let bytes: Uint8Array;
    let contentType: string;
    try {
      ({ bytes, contentType } = decodeImage(body.image ?? ""));
    } catch {
      return c.json({ error: "a photo image is required" }, 400);
    }

    const imageKey = `attachments/${recordId}/${body.id}`;
    // Only rewrite the R2 blob when the bytes differ from what's stored.
    const existing = await attachments.getById(body.id);
    const stored = existing ? await images.get(existing.image_key) : null;
    if (!stored || !bytesEqual(stored, bytes)) {
      await images.put(imageKey, bytes, contentType);
    }
    const row: AttachmentRow = {
      id: body.id,
      record_id: recordId,
      field_id: body.field_id,
      kind: "photo",
      image_key: existing?.image_key ?? imageKey,
      caption: body.caption ?? "",
      device_id: body.device_id,
      created_at: body.created_at,
    };
    await attachments.upsert(row);
    return c.json({ applied: true });
  });

  // Read a record's photos on another signed-in device (§8): list the metadata,
  // then fetch each image. `<img src>` can't send a bearer, so the client fetches
  // the bytes with auth and backfills them into its local store.
  app.get("/api/records/:id/attachments", requireUser, async (c) => {
    const recordId = c.req.param("id");
    if (!(await store.get(recordId))) return c.json({ error: "not found" }, 404);
    const rows = await attachments.listByRecord(recordId);
    return c.json(
      rows.map((a) => ({
        id: a.id,
        field_id: a.field_id,
        caption: a.caption,
        device_id: a.device_id,
        created_at: a.created_at,
      })),
    );
  });

  app.get("/api/records/:id/attachments/:attachmentId", requireUser, async (c) => {
    const att = await attachments.getById(c.req.param("attachmentId"));
    if (!att || att.record_id !== c.req.param("id")) {
      return c.json({ error: "not found" }, 404);
    }
    const bytes = await images.get(att.image_key);
    if (!bytes) return c.json({ error: "not found" }, 404);
    return new Response(bytes as BodyInit, {
      status: 200,
      headers: {
        "content-type": imageContentType(bytes),
        "cache-control": "private, max-age=300",
      },
    });
  });

  app.post("/api/records/:id/audit", requireUser, async (c) => {
    const recordId = c.req.param("id");
    if (!(await store.get(recordId))) return c.json({ error: "not found" }, 404);

    let body: {
      id?: string; role?: string; action?: string; user?: string | null;
      before?: string | null; after?: string | null; reason?: string | null; at?: string;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    if (!body.id || !body.role || !body.action || !body.at) {
      return c.json({ error: "invalid audit entry" }, 400);
    }
    const row: AuditRow = {
      id: body.id,
      record_id: recordId,
      user: body.user ?? null,
      role: body.role,
      action: body.action,
      before: body.before ?? null,
      after: body.after ?? null,
      reason: body.reason ?? null,
      at: body.at,
    };

    const existing = await audit.getById(body.id);
    if (existing) {
      if (auditFingerprint(existing) !== auditFingerprint(row)) {
        return c.json({ error: "evidence_conflict" }, 409);
      }
      return c.json({ applied: false }); // insert-once no-op
    }
    await audit.add(row);
    return c.json({ applied: true }, 201);
  });

  // --- Remote sign-off: issue (privileged, QA/QC) --------------------------

  app.post("/api/records/:id/sign-requests", requireUser, requireRole(ROLE_QA), async (c) => {
    const actor = c.get("user");
    const recordId = c.req.param("id");
    const record = await store.get(recordId);
    if (!record) return c.json({ error: "not found" }, 404);

    let body: {
      slot_id?: string;
      role?: string;
      recipient_name?: string | null;
      recipient_email?: string;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    if (!body.slot_id || !body.role || !body.recipient_email) {
      return c.json({ error: "slot_id, role and recipient_email are required" }, 400);
    }

    const token = genToken();
    const issuedAt = now();
    const expiresAt = new Date(new Date(issuedAt).getTime() + EXPIRY_DAYS * 86_400_000).toISOString();
    const req: SignatureRequest = {
      id: newId(),
      record_id: recordId,
      slot_id: body.slot_id,
      role: body.role,
      recipient_name: body.recipient_name ?? null,
      recipient_email: body.recipient_email,
      token_hash: await hashToken(token),
      status: "sent",
      sent_at: issuedAt,
      opened_at: null,
      closed_at: null,
      expires_at: expiresAt,
      reject_reason: null,
      record_version_at_send: record.updated_at,
    };
    await signRequests.create(req);
    await writeAudit(recordId, ROLE_QA, "issued", { after: req.id, user: actor.email });

    const base = deps.signBaseUrl ?? new URL(c.req.url).origin;
    const url = `${base.replace(/\/$/, "")}/sign/${token}`;

    // Deliver the link. Best-effort: the link is valid and returned regardless, so
    // a delivery failure never fails issuance — QA/QC can still copy the link. The
    // outcome is audited and reported so the UI can prompt a manual send.
    const serialNo = typeof record.serial_no === "string" ? record.serial_no : null;
    const message = buildSignRequestEmail({
      recipientName: req.recipient_name,
      role: req.role,
      url,
      expiresAt,
      serialNo,
    });
    let emailed = false;
    try {
      await email.send({
        to: req.recipient_email,
        toName: req.recipient_name,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
      emailed = true;
      await writeAudit(recordId, ROLE_QA, "emailed", { after: req.recipient_email });
    } catch (e) {
      await writeAudit(recordId, ROLE_QA, "email_failed", {
        reason: e instanceof Error ? e.message : "send failed",
      });
    }

    return c.json({ id: req.id, token, url, expires_at: expiresAt, emailed }, 201);
  });

  // --- Remote sign-off: public token endpoints -----------------------------

  type Resolved =
    | { ok: true; req: SignatureRequest; record: IncomingRecord }
    | { ok: false; status: 404 | 409 | 410; body: Record<string, unknown> };

  /**
   * Shared validation for the public token endpoints: unknown → 404, already
   * closed → 409/410, past-expiry → lazily mark expired (+audit) then 410,
   * record gone → 404, version drift → 409 (reissue needed). On success returns
   * the live request + record. Does NOT mark "opened" — that is the GET's job.
   */
  async function resolve(token: string): Promise<Resolved> {
    const req = await signRequests.getByTokenHash(await hashToken(token));
    if (!req) return { ok: false, status: 404, body: { error: "unknown token" } };

    if (req.status === "expired") {
      return { ok: false, status: 410, body: { error: "expired" } };
    }
    if (CLOSED_REQUEST_STATUSES.includes(req.status)) {
      return { ok: false, status: 409, body: { error: "closed", status: req.status } };
    }
    if (now() > req.expires_at) {
      const expired = { ...req, status: "expired" as const, closed_at: now() };
      await signRequests.update(expired);
      await writeAudit(req.record_id, req.role, "expired", {
        id: await deterministicId(`audit:${req.id}:expired`),
      });
      return { ok: false, status: 410, body: { error: "expired" } };
    }

    const record = await store.get(req.record_id);
    if (!record) return { ok: false, status: 404, body: { error: "record not found" } };
    if (req.record_version_at_send !== record.updated_at) {
      return {
        ok: false,
        status: 409,
        body: { error: "version_mismatch", detail: "record changed since the link was issued" },
      };
    }
    return { ok: true, req, record };
  }

  // Open the link: view the record read-only + who is being asked to sign.
  app.get("/api/sign/:token", async (c) => {
    const r = await resolve(c.req.param("token"));
    if (!r.ok) return c.json(r.body, r.status);

    if (r.req.status === "sent") {
      const opened = { ...r.req, status: "opened" as const, opened_at: now() };
      await signRequests.update(opened);
      await writeAudit(r.req.record_id, r.req.role, "opened", {
        id: await deterministicId(`audit:${r.req.id}:opened`),
      });
    }
    const photos = await attachments.listByRecord(r.req.record_id);
    return c.json({
      record: r.record,
      slot: { slot_id: r.req.slot_id, role: r.req.role },
      recipient: { name: r.req.recipient_name, email: r.req.recipient_email },
      expires_at: r.req.expires_at,
      status: "opened",
      // Metadata only — the signer fetches each image from the token-gated route
      // below, so a large photo set doesn't bloat this JSON.
      attachments: photos.map((a) => ({ id: a.id, field_id: a.field_id, caption: a.caption })),
    });
  });

  // Serve one attachment's image bytes, gated by the same single-use token. The
  // remote signer has no account, so this is how the sign page shows photo
  // evidence (§6). The attachment must belong to the linked record.
  app.get("/api/sign/:token/attachments/:attachmentId", async (c) => {
    const r = await resolve(c.req.param("token"));
    if (!r.ok) return c.json(r.body, r.status);
    const att = await attachments.getById(c.req.param("attachmentId"));
    if (!att || att.record_id !== r.req.record_id) {
      return c.json({ error: "not found" }, 404);
    }
    const bytes = await images.get(att.image_key);
    if (!bytes) return c.json({ error: "not found" }, 404);
    return new Response(bytes as BodyInit, {
      status: 200,
      headers: {
        "content-type": imageContentType(bytes),
        "cache-control": "private, max-age=300",
      },
    });
  });

  // Submit a drawn signature.
  app.post("/api/sign/:token", async (c) => {
    const r = await resolve(c.req.param("token"));
    if (!r.ok) return c.json(r.body, r.status);

    let body: { image?: string; name?: string; company?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    let bytes: Uint8Array;
    let contentType: string;
    try {
      ({ bytes, contentType } = decodeImage(body.image ?? ""));
    } catch {
      return c.json({ error: "a signature image is required" }, 400);
    }

    const imageKey = `signatures/${r.req.record_id}/${r.req.id}.png`;
    await images.put(imageKey, bytes, contentType);

    const signedAt = now();
    const signerIp = c.req.header("cf-connecting-ip") ?? null;
    // The signature id is the request id, not a fresh newId(): a remote signature
    // is 1:1 with its single-use request, so this makes a concurrent double-submit
    // of one token collide on the same id and dedupe via insert-once (§12) instead
    // of writing two rows for one slot. The request id is already a UUIDv7.
    await signatures.add({
      id: r.req.id,
      record_id: r.req.record_id,
      slot_id: r.req.slot_id,
      role: r.req.role,
      name: body.name ?? r.req.recipient_name ?? "",
      company: body.company ?? "",
      method: "remote_link",
      signed_by_user: null,
      device_id: "remote",
      image_key: imageKey,
      signed_at: signedAt,
      signer_email: r.req.recipient_email,
      signer_ip: signerIp,
    });

    await signRequests.update({ ...r.req, status: "signed", closed_at: signedAt });
    await writeAudit(r.req.record_id, r.req.role, "signed", {
      id: await deterministicId(`audit:${r.req.id}:signed`),
    });
    return c.json({ ok: true });
  });

  // Reject: closes the request and flips the record to "rejected" (§6).
  app.post("/api/sign/:token/reject", async (c) => {
    const r = await resolve(c.req.param("token"));
    if (!r.ok) return c.json(r.body, r.status);

    let body: { reason?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const reason = (body.reason ?? "").trim();
    if (!reason) return c.json({ error: "a rejection reason is required" }, 400);

    const rejectedAt = now();
    await signRequests.update({
      ...r.req,
      status: "rejected",
      reject_reason: reason,
      closed_at: rejectedAt,
    });
    await store.setStatus(r.req.record_id, "rejected", rejectedAt);
    await writeAudit(r.req.record_id, r.req.role, "rejected", {
      reason,
      id: await deterministicId(`audit:${r.req.id}:rejected`),
    });
    return c.json({ ok: true });
  });

  // Revoke an outstanding request (privileged, QA/QC).
  app.post("/api/sign-requests/:id/revoke", requireUser, requireRole(ROLE_QA), async (c) => {
    const req = await signRequests.getById(c.req.param("id"));
    if (!req) return c.json({ error: "not found" }, 404);
    if (CLOSED_REQUEST_STATUSES.includes(req.status)) {
      return c.json({ error: "already closed", status: req.status }, 409);
    }
    await signRequests.update({ ...req, status: "revoked", closed_at: now() });
    await writeAudit(req.record_id, ROLE_QA, "revoked", {
      after: req.id,
      user: c.get("user").email,
      id: await deterministicId(`audit:${req.id}:revoked`),
    });
    return c.json({ ok: true });
  });

  return app;
}
