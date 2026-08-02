import type { D1Database, R2Bucket } from "@cloudflare/workers-types";

/** A synced record as the client sends it — the full JSON, keyed by client id. */
export interface IncomingRecord {
  id: string;
  template_version_id: string;
  status: string;
  project_id?: string | null;
  updated_at: string;
  [key: string]: unknown;
}

export interface UpsertResult {
  /** False when a newer copy already exists (last-write-wins by `updated_at`). */
  applied: boolean;
}

/**
 * The record persistence the API depends on. Kept behind an interface so the Hono
 * app can be tested against an in-memory store without the Workers runtime, while
 * production uses D1.
 */
export interface RecordStore {
  upsert(record: IncomingRecord): Promise<UpsertResult>;
  get(id: string): Promise<IncomingRecord | null>;
  /**
   * Force a status change (used when a remote reject flips the record to
   * "rejected", §6). Bumps `updated_at` — which, by design, voids any other
   * outstanding sign request on the record via the version check. No-op if the
   * record is absent.
   */
  setStatus(id: string, status: string, updatedAt: string): Promise<void>;
}

/** D1-backed store. Idempotent upsert keyed by client id, last-write-wins. */
export class D1RecordStore implements RecordStore {
  constructor(private readonly db: D1Database) {}

  async upsert(record: IncomingRecord): Promise<UpsertResult> {
    const existing = await this.db
      .prepare("SELECT updated_at FROM records WHERE id = ?")
      .bind(record.id)
      .first<{ updated_at: string }>();
    if (existing && existing.updated_at >= record.updated_at) {
      return { applied: false };
    }
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO records
           (id, template_version_id, status, project_id, updated_at, body)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        record.id,
        record.template_version_id,
        record.status,
        record.project_id ?? null,
        record.updated_at,
        JSON.stringify(record),
      )
      .run();
    return { applied: true };
  }

  async get(id: string): Promise<IncomingRecord | null> {
    const row = await this.db
      .prepare("SELECT body FROM records WHERE id = ?")
      .bind(id)
      .first<{ body: string }>();
    return row ? (JSON.parse(row.body) as IncomingRecord) : null;
  }

  async setStatus(id: string, status: string, updatedAt: string): Promise<void> {
    const current = await this.get(id);
    if (!current) return;
    const next = { ...current, status, updated_at: updatedAt };
    await this.db
      .prepare("UPDATE records SET status = ?, updated_at = ?, body = ? WHERE id = ?")
      .bind(status, updatedAt, JSON.stringify(next), id)
      .run();
  }
}

/** In-memory store for tests — same last-write-wins semantics as D1. */
export class MemoryRecordStore implements RecordStore {
  private readonly map = new Map<string, IncomingRecord>();

  async upsert(record: IncomingRecord): Promise<UpsertResult> {
    const existing = this.map.get(record.id);
    if (existing && existing.updated_at >= record.updated_at) {
      return { applied: false };
    }
    this.map.set(record.id, record);
    return { applied: true };
  }

  async get(id: string): Promise<IncomingRecord | null> {
    return this.map.get(id) ?? null;
  }

  async setStatus(id: string, status: string, updatedAt: string): Promise<void> {
    const current = this.map.get(id);
    if (!current) return;
    this.map.set(id, { ...current, status, updated_at: updatedAt });
  }
}

// ---------------------------------------------------------------------------
// Remote sign-off (SPEC §6 path B), server task 2a.
// ---------------------------------------------------------------------------

/** Lifecycle of a remote signature request. Closed = signed|rejected|revoked|expired. */
export type SignatureRequestStatus =
  | "sent"
  | "opened"
  | "signed"
  | "rejected"
  | "revoked"
  | "expired";

export const CLOSED_REQUEST_STATUSES: readonly SignatureRequestStatus[] = [
  "signed",
  "rejected",
  "revoked",
  "expired",
];

/**
 * A request to sign one signature slot of a record via a tokenized link. We
 * persist only the sha-256 `token_hash` — never the raw token (§6). Freeze is
 * lazy: `record_version_at_send` is compared against the record's live
 * `updated_at` at open/sign time; a mismatch voids the link (reissue needed).
 */
export interface SignatureRequest {
  id: string;
  record_id: string;
  /** Template signature slot id being filled, e.g. "sig_witness". */
  slot_id: string;
  /** Printed role snapshotted from the slot, e.g. "witness". */
  role: string;
  recipient_name: string | null;
  recipient_email: string;
  token_hash: string;
  status: SignatureRequestStatus;
  sent_at: string | null;
  opened_at: string | null;
  closed_at: string | null;
  expires_at: string;
  reject_reason: string | null;
  record_version_at_send: string;
}

export interface SignatureRequestStore {
  create(req: SignatureRequest): Promise<void>;
  getByTokenHash(hash: string): Promise<SignatureRequest | null>;
  getById(id: string): Promise<SignatureRequest | null>;
  /** Persist the mutable lifecycle fields (status/opened_at/closed_at/reject_reason). */
  update(req: SignatureRequest): Promise<void>;
}

/** A persisted signature row (both on-device path A and remote path B). */
export interface SignatureRow {
  id: string;
  record_id: string;
  slot_id: string;
  role: string;
  name: string;
  company: string;
  method: string;
  signed_by_user: string | null;
  device_id: string;
  image_key: string;
  signed_at: string;
  /** remote_link evidence (§6); null for on-device. */
  signer_email: string | null;
  signer_ip: string | null;
}

export interface SignatureStore {
  add(sig: SignatureRow): Promise<void>;
  listByRecord(recordId: string): Promise<SignatureRow[]>;
}

/** An append-only audit entry (§9). */
export interface AuditRow {
  id: string;
  record_id: string;
  user: string | null;
  role: string;
  action: string;
  before: string | null;
  after: string | null;
  reason: string | null;
  at: string;
}

export interface AuditStore {
  add(entry: AuditRow): Promise<void>;
  listByRecord(recordId: string): Promise<AuditRow[]>;
}

/** Stores the signature PNG bytes. R2 in production; in-memory in tests. */
export interface SignatureImageStore {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
}

// --- D1 / R2 implementations ----------------------------------------------

const SIGREQ_COLUMNS =
  "id, record_id, slot_id, role, recipient_name, recipient_email, token_hash, status, sent_at, opened_at, closed_at, expires_at, reject_reason, record_version_at_send";

export class D1SignatureRequestStore implements SignatureRequestStore {
  constructor(private readonly db: D1Database) {}

  async create(r: SignatureRequest): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO signature_requests (${SIGREQ_COLUMNS})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        r.id,
        r.record_id,
        r.slot_id,
        r.role,
        r.recipient_name,
        r.recipient_email,
        r.token_hash,
        r.status,
        r.sent_at,
        r.opened_at,
        r.closed_at,
        r.expires_at,
        r.reject_reason,
        r.record_version_at_send,
      )
      .run();
  }

  async getByTokenHash(hash: string): Promise<SignatureRequest | null> {
    const row = await this.db
      .prepare(`SELECT ${SIGREQ_COLUMNS} FROM signature_requests WHERE token_hash = ?`)
      .bind(hash)
      .first<SignatureRequest>();
    return row ?? null;
  }

  async getById(id: string): Promise<SignatureRequest | null> {
    const row = await this.db
      .prepare(`SELECT ${SIGREQ_COLUMNS} FROM signature_requests WHERE id = ?`)
      .bind(id)
      .first<SignatureRequest>();
    return row ?? null;
  }

  async update(r: SignatureRequest): Promise<void> {
    await this.db
      .prepare(
        `UPDATE signature_requests
           SET status = ?, opened_at = ?, closed_at = ?, reject_reason = ?
         WHERE id = ?`,
      )
      .bind(r.status, r.opened_at, r.closed_at, r.reject_reason, r.id)
      .run();
  }
}

const SIGNATURE_COLUMNS =
  "id, record_id, slot_id, role, name, company, method, signed_by_user, device_id, image_key, signed_at, signer_email, signer_ip";

export class D1SignatureStore implements SignatureStore {
  constructor(private readonly db: D1Database) {}

  async add(s: SignatureRow): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO signatures (${SIGNATURE_COLUMNS})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        s.id,
        s.record_id,
        s.slot_id,
        s.role,
        s.name,
        s.company,
        s.method,
        s.signed_by_user,
        s.device_id,
        s.image_key,
        s.signed_at,
        s.signer_email,
        s.signer_ip,
      )
      .run();
  }

  async listByRecord(recordId: string): Promise<SignatureRow[]> {
    const res = await this.db
      .prepare(`SELECT ${SIGNATURE_COLUMNS} FROM signatures WHERE record_id = ?`)
      .bind(recordId)
      .all<SignatureRow>();
    return res.results ?? [];
  }
}

export class D1AuditStore implements AuditStore {
  constructor(private readonly db: D1Database) {}

  async add(e: AuditRow): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO audit_log (id, record_id, user, role, action, before, after, reason, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(e.id, e.record_id, e.user, e.role, e.action, e.before, e.after, e.reason, e.at)
      .run();
  }

  async listByRecord(recordId: string): Promise<AuditRow[]> {
    const res = await this.db
      .prepare("SELECT * FROM audit_log WHERE record_id = ? ORDER BY at ASC")
      .bind(recordId)
      .all<AuditRow>();
    return res.results ?? [];
  }
}

export class R2SignatureImageStore implements SignatureImageStore {
  constructor(private readonly bucket: R2Bucket) {}

  async put(key: string, data: Uint8Array, contentType: string): Promise<void> {
    await this.bucket.put(key, data, { httpMetadata: { contentType } });
  }

  async get(key: string): Promise<Uint8Array | null> {
    const obj = await this.bucket.get(key);
    return obj ? new Uint8Array(await obj.arrayBuffer()) : null;
  }
}

// --- In-memory fakes (tests) ----------------------------------------------

export class MemorySignatureRequestStore implements SignatureRequestStore {
  private readonly byId = new Map<string, SignatureRequest>();

  async create(req: SignatureRequest): Promise<void> {
    this.byId.set(req.id, { ...req });
  }

  async getByTokenHash(hash: string): Promise<SignatureRequest | null> {
    for (const r of this.byId.values()) if (r.token_hash === hash) return { ...r };
    return null;
  }

  async getById(id: string): Promise<SignatureRequest | null> {
    const r = this.byId.get(id);
    return r ? { ...r } : null;
  }

  async update(req: SignatureRequest): Promise<void> {
    this.byId.set(req.id, { ...req });
  }
}

export class MemorySignatureStore implements SignatureStore {
  readonly rows: SignatureRow[] = [];
  async add(sig: SignatureRow): Promise<void> {
    this.rows.push({ ...sig });
  }
  async listByRecord(recordId: string): Promise<SignatureRow[]> {
    return this.rows.filter((r) => r.record_id === recordId);
  }
}

export class MemoryAuditStore implements AuditStore {
  readonly rows: AuditRow[] = [];
  async add(entry: AuditRow): Promise<void> {
    this.rows.push({ ...entry });
  }
  async listByRecord(recordId: string): Promise<AuditRow[]> {
    return this.rows.filter((r) => r.record_id === recordId);
  }
}

export class MemorySignatureImageStore implements SignatureImageStore {
  readonly map = new Map<string, { data: Uint8Array; contentType: string }>();
  async put(key: string, data: Uint8Array, contentType: string): Promise<void> {
    this.map.set(key, { data, contentType });
  }
  async get(key: string): Promise<Uint8Array | null> {
    return this.map.get(key)?.data ?? null;
  }
}

// ---------------------------------------------------------------------------
// Users + sessions (SPEC §3, §9), task 4 — real email/password auth.
// ---------------------------------------------------------------------------

/** Roles a user can hold (§9). Matches the client's acting-role set. */
export type UserRole = "site_engineer" | "qa_qc";

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  /** PBKDF2 hash string (see auth.ts). Never returned to clients. */
  password_hash: string;
  created_at: string;
}

export interface UserStore {
  getByEmail(email: string): Promise<User | null>;
  getById(id: string): Promise<User | null>;
  create(user: User): Promise<void>;
}

/** A bearer session. Only the sha-256 `token_hash` is stored, never the token. */
export interface Session {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: string;
  expires_at: string;
}

export interface SessionStore {
  create(session: Session): Promise<void>;
  getByTokenHash(hash: string): Promise<Session | null>;
  deleteByTokenHash(hash: string): Promise<void>;
}

export class D1UserStore implements UserStore {
  constructor(private readonly db: D1Database) {}

  async getByEmail(email: string): Promise<User | null> {
    const row = await this.db
      .prepare("SELECT id, email, name, role, password_hash, created_at FROM users WHERE email = ?")
      .bind(email.toLowerCase())
      .first<User>();
    return row ?? null;
  }

  async getById(id: string): Promise<User | null> {
    const row = await this.db
      .prepare("SELECT id, email, name, role, password_hash, created_at FROM users WHERE id = ?")
      .bind(id)
      .first<User>();
    return row ?? null;
  }

  async create(user: User): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO users (id, email, name, role, password_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        user.id,
        user.email.toLowerCase(),
        user.name,
        user.role,
        user.password_hash,
        user.created_at,
      )
      .run();
  }
}

export class D1SessionStore implements SessionStore {
  constructor(private readonly db: D1Database) {}

  async create(s: Session): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(s.id, s.user_id, s.token_hash, s.created_at, s.expires_at)
      .run();
  }

  async getByTokenHash(hash: string): Promise<Session | null> {
    const row = await this.db
      .prepare(
        "SELECT id, user_id, token_hash, created_at, expires_at FROM sessions WHERE token_hash = ?",
      )
      .bind(hash)
      .first<Session>();
    return row ?? null;
  }

  async deleteByTokenHash(hash: string): Promise<void> {
    await this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(hash).run();
  }
}

export class MemoryUserStore implements UserStore {
  private readonly byId = new Map<string, User>();

  async getByEmail(email: string): Promise<User | null> {
    const target = email.toLowerCase();
    for (const u of this.byId.values()) if (u.email.toLowerCase() === target) return { ...u };
    return null;
  }
  async getById(id: string): Promise<User | null> {
    const u = this.byId.get(id);
    return u ? { ...u } : null;
  }
  async create(user: User): Promise<void> {
    this.byId.set(user.id, { ...user, email: user.email.toLowerCase() });
  }
}

export class MemorySessionStore implements SessionStore {
  private readonly byHash = new Map<string, Session>();

  async create(session: Session): Promise<void> {
    this.byHash.set(session.token_hash, { ...session });
  }
  async getByTokenHash(hash: string): Promise<Session | null> {
    const s = this.byHash.get(hash);
    return s ? { ...s } : null;
  }
  async deleteByTokenHash(hash: string): Promise<void> {
    this.byHash.delete(hash);
  }
}
