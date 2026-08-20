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
  /**
   * True when the write was refused because the server copy is in a locked,
   * server-authoritative status (`accepted` or `rejected`, §6/§8) and the client
   * pushed a newer version. Lets the UI warn and pull rather than lose the change
   * silently. Absent on the ordinary last-write-wins path.
   */
  conflict?: boolean;
}

/**
 * Statuses the server treats as locked: a client push never overwrites a record
 * already `accepted` (locked forever, §6) or `rejected` (superseded by a revision
 * under a new id — the rejected record itself is frozen). Extends SPEC §8's
 * conflict rule beyond `accepted` so a remote rejection can't be clobbered by a
 * stale client transition arriving with a newer `updated_at`.
 */
const LOCKED_STATUSES: ReadonlySet<string> = new Set(["accepted", "rejected"]);

/**
 * The record persistence the API depends on. Kept behind an interface so the Hono
 * app can be tested against an in-memory store without the Workers runtime, while
 * production uses D1.
 */
export interface RecordStore {
  upsert(record: IncomingRecord): Promise<UpsertResult>;
  get(id: string): Promise<IncomingRecord | null>;
  /**
   * Every record body. The register's durable pull/merge (SPEC §8): a browser
   * whose IndexedDB was cleared re-reads the whole set on login, so records that
   * synced up are never "gone" just because the local copy was.
   */
  list(): Promise<IncomingRecord[]>;
  /**
   * Force a status change (used when a remote reject flips the record to
   * "rejected", §6). Bumps `updated_at` — which, by design, voids any other
   * outstanding sign request on the record via the version check. No-op if the
   * record is absent.
   *
   * Safety (task #6 review): the only caller is the public reject endpoint, and a
   * second reject on the same token is blocked upstream (`resolve()` → 409 closed),
   * so this never double-fires. It is a dumb setter with no `updated_at` guard, but
   * it is always called with a fresh server `now()` and is never client-replayed.
   * The status it writes is one of the locked set below, so a later client upsert
   * carrying a newer `updated_at` can no longer last-write-wins over the server-set
   * "rejected" — `upsert` treats it as a conflict, not an overwrite (§8).
   */
  setStatus(id: string, status: string, updatedAt: string): Promise<void>;
}

/** D1-backed store. Idempotent upsert keyed by client id, last-write-wins. */
export class D1RecordStore implements RecordStore {
  constructor(private readonly db: D1Database) {}

  async upsert(record: IncomingRecord): Promise<UpsertResult> {
    const existing = await this.db
      .prepare("SELECT updated_at, status FROM records WHERE id = ?")
      .bind(record.id)
      .first<{ updated_at: string; status: string }>();
    if (existing && LOCKED_STATUSES.has(existing.status)) {
      // Locked server-side (§6, §8): never overwritten by a client push.
      return { applied: false, conflict: record.updated_at > existing.updated_at };
    }
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

  async list(): Promise<IncomingRecord[]> {
    const res = await this.db.prepare("SELECT body FROM records").all<{ body: string }>();
    return (res.results ?? []).map((r) => JSON.parse(r.body) as IncomingRecord);
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
    if (existing && LOCKED_STATUSES.has(existing.status)) {
      // Locked server-side (§6, §8): never overwritten by a client push.
      return { applied: false, conflict: record.updated_at > existing.updated_at };
    }
    if (existing && existing.updated_at >= record.updated_at) {
      return { applied: false };
    }
    this.map.set(record.id, record);
    return { applied: true };
  }

  async get(id: string): Promise<IncomingRecord | null> {
    return this.map.get(id) ?? null;
  }

  async list(): Promise<IncomingRecord[]> {
    return [...this.map.values()].map((r) => ({ ...r }));
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
  /**
   * Persist the mutable lifecycle fields (status/opened_at/closed_at/reject_reason).
   *
   * Safety (task #6 review): a dumb setter. The legal state machine
   * (sent→opened→signed|rejected|revoked|expired) is enforced by the endpoints
   * before this is called — `resolve()` blocks acting on an expired/closed request,
   * revoke blocks a closed one — so an illegal or repeated transition can't reach
   * here in sequence, and it is never client-replayed. The one gap is a true
   * concurrent double-submit of a single token (no D1 transaction), which can
   * duplicate the remote signature row; tracked separately.
   */
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
  /** Insert-once (SPEC §12): a duplicate id is ignored, never overwritten. */
  add(sig: SignatureRow): Promise<void>;
  getById(id: string): Promise<SignatureRow | null>;
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
  /** Insert-once (SPEC §12): a duplicate id is ignored, never overwritten. */
  add(entry: AuditRow): Promise<void>;
  getById(id: string): Promise<AuditRow | null>;
  listByRecord(recordId: string): Promise<AuditRow[]>;
}

/** Stores the signature PNG bytes. R2 in production; in-memory in tests. */
export interface SignatureImageStore {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
}

/** A persisted photo attachment (SPEC §4, §8). Image bytes live in R2 (image_key). */
export interface AttachmentRow {
  id: string;
  record_id: string;
  field_id: string;
  kind: string;
  image_key: string;
  caption: string;
  device_id: string;
  created_at: string;
}

/**
 * One test instrument in the calibration register (SPEC §4, §10 screen 9).
 * Reference data, not evidence: a renewed certificate edits the row in place, so
 * this syncs as an upsert by client id rather than insert-once. `deleted` is a
 * tombstone — a removal has to travel between devices, and a hard delete would
 * just be re-created by the next push from a device that still held the row.
 */
export interface InstrumentRow {
  id: string;
  serial_no: string;
  description: string;
  cal_cert_url: string;
  /** Certificate number as printed by the lab, e.g. `BLE2604334-2`; may be blank. */
  cert_no: string;
  cal_date: string;
  cal_due_date: string;
  updated_at: string;
  deleted: number;
}

export interface InstrumentStore {
  /**
   * Upsert by client id, last-write-wins on `updated_at`. An older push (a
   * device that has been offline since before the row was edited) must not
   * clobber a newer one, so a stale write is dropped rather than applied.
   */
  upsert(row: InstrumentRow): Promise<void>;
  /** Every row including tombstones — the client needs those to apply deletes. */
  list(): Promise<InstrumentRow[]>;
}

export interface AttachmentStore {
  /** Upsert by client id (last-write-wins) — a caption edit re-pushes the row. */
  upsert(row: AttachmentRow): Promise<void>;
  getById(id: string): Promise<AttachmentRow | null>;
  listByRecord(recordId: string): Promise<AttachmentRow[]>;
}

/**
 * The project registry's server side (SPEC §4, §10 screen 8). Reference data in
 * the client-owned, local-first class (§12) — like `instruments`, not evidence:
 * upsert by client UUIDv7 id, last-write-wins on `updated_at`. Before this the
 * registry lived only in the browser that typed it, so a cleared browser lost
 * every project, system, and equipment tag.
 */
export interface ProjectRow {
  id: string;
  code: string;
  name: string;
  client: string;
  status: string;
  created_at: string;
  closed_at: string | null;
  updated_at: string;
  /** Tombstone (0/1) — a delete travels between devices like instrument deletes. */
  deleted: number;
}

export interface SystemRow {
  id: string;
  project_id: string;
  name: string;
  code: string;
  parent_system_id: string | null;
  updated_at: string;
  deleted: number;
}

export interface EquipmentRow {
  id: string;
  project_id: string;
  system_id: string;
  tag: string;
  description: string;
  location: string;
  drawing_ref: string;
  updated_at: string;
  deleted: number;
}

export interface RegistrySnapshotRows {
  projects: ProjectRow[];
  systems: SystemRow[];
  equipment: EquipmentRow[];
}

export interface RegistryStore {
  /** Upsert by client id; a stale push (older `updated_at`) is dropped. */
  upsertProject(row: ProjectRow): Promise<void>;
  upsertSystem(row: SystemRow): Promise<void>;
  upsertEquipment(row: EquipmentRow): Promise<void>;
  /** The whole registry — small reference data, read in one call. */
  list(): Promise<RegistrySnapshotRows>;
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
        `INSERT OR IGNORE INTO signatures (${SIGNATURE_COLUMNS})
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

  async getById(id: string): Promise<SignatureRow | null> {
    const row = await this.db
      .prepare(`SELECT ${SIGNATURE_COLUMNS} FROM signatures WHERE id = ?`)
      .bind(id)
      .first<SignatureRow>();
    return row ?? null;
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
        `INSERT OR IGNORE INTO audit_log (id, record_id, user, role, action, before, after, reason, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(e.id, e.record_id, e.user, e.role, e.action, e.before, e.after, e.reason, e.at)
      .run();
  }

  async getById(id: string): Promise<AuditRow | null> {
    const row = await this.db
      .prepare("SELECT * FROM audit_log WHERE id = ?")
      .bind(id)
      .first<AuditRow>();
    return row ?? null;
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

const ATTACHMENT_COLUMNS =
  "id, record_id, field_id, kind, image_key, caption, device_id, created_at";

const INSTRUMENT_COLUMNS =
  "id, serial_no, description, cal_cert_url, cert_no, cal_date, cal_due_date, updated_at, deleted";

export class D1InstrumentStore implements InstrumentStore {
  constructor(private readonly db: D1Database) {}

  async upsert(i: InstrumentRow): Promise<void> {
    // The WHERE on the DO UPDATE is the last-write-wins guard: a push carrying an
    // older `updated_at` than the stored row is ignored, so a device that has been
    // offline since before an edit cannot resurrect the superseded values.
    await this.db
      .prepare(
        `INSERT INTO instruments (${INSTRUMENT_COLUMNS})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           serial_no    = excluded.serial_no,
           description  = excluded.description,
           cal_cert_url = excluded.cal_cert_url,
           cert_no      = excluded.cert_no,
           cal_date     = excluded.cal_date,
           cal_due_date = excluded.cal_due_date,
           updated_at   = excluded.updated_at,
           deleted      = excluded.deleted
         WHERE excluded.updated_at >= instruments.updated_at`,
      )
      .bind(
        i.id,
        i.serial_no,
        i.description,
        i.cal_cert_url,
        i.cert_no,
        i.cal_date,
        i.cal_due_date,
        i.updated_at,
        i.deleted,
      )
      .run();
  }

  async list(): Promise<InstrumentRow[]> {
    const res = await this.db
      .prepare(`SELECT ${INSTRUMENT_COLUMNS} FROM instruments`)
      .all<InstrumentRow>();
    return res.results ?? [];
  }
}

const PROJECT_COLUMNS =
  "id, code, name, client, status, created_at, closed_at, updated_at, deleted";
const SYSTEM_COLUMNS = "id, project_id, name, code, parent_system_id, updated_at, deleted";
const EQUIPMENT_COLUMNS =
  "id, project_id, system_id, tag, description, location, drawing_ref, updated_at, deleted";

export class D1RegistryStore implements RegistryStore {
  constructor(private readonly db: D1Database) {}

  // As with instruments, the WHERE on each DO UPDATE is the last-write-wins
  // guard: a device offline since before an edit cannot resurrect old values.

  async upsertProject(p: ProjectRow): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO projects (${PROJECT_COLUMNS})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           code       = excluded.code,
           name       = excluded.name,
           client     = excluded.client,
           status     = excluded.status,
           created_at = excluded.created_at,
           closed_at  = excluded.closed_at,
           updated_at = excluded.updated_at,
           deleted    = excluded.deleted
         WHERE excluded.updated_at >= projects.updated_at`,
      )
      .bind(
        p.id,
        p.code,
        p.name,
        p.client,
        p.status,
        p.created_at,
        p.closed_at,
        p.updated_at,
        p.deleted,
      )
      .run();
  }

  async upsertSystem(s: SystemRow): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO systems (${SYSTEM_COLUMNS})
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           project_id       = excluded.project_id,
           name             = excluded.name,
           code             = excluded.code,
           parent_system_id = excluded.parent_system_id,
           updated_at       = excluded.updated_at,
           deleted          = excluded.deleted
         WHERE excluded.updated_at >= systems.updated_at`,
      )
      .bind(s.id, s.project_id, s.name, s.code, s.parent_system_id, s.updated_at, s.deleted)
      .run();
  }

  async upsertEquipment(e: EquipmentRow): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO equipment (${EQUIPMENT_COLUMNS})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           project_id  = excluded.project_id,
           system_id   = excluded.system_id,
           tag         = excluded.tag,
           description = excluded.description,
           location    = excluded.location,
           drawing_ref = excluded.drawing_ref,
           updated_at  = excluded.updated_at,
           deleted     = excluded.deleted
         WHERE excluded.updated_at >= equipment.updated_at`,
      )
      .bind(
        e.id,
        e.project_id,
        e.system_id,
        e.tag,
        e.description,
        e.location,
        e.drawing_ref,
        e.updated_at,
        e.deleted,
      )
      .run();
  }

  async list(): Promise<RegistrySnapshotRows> {
    const [projects, systems, equipment] = await Promise.all([
      this.db.prepare(`SELECT ${PROJECT_COLUMNS} FROM projects`).all<ProjectRow>(),
      this.db.prepare(`SELECT ${SYSTEM_COLUMNS} FROM systems`).all<SystemRow>(),
      this.db.prepare(`SELECT ${EQUIPMENT_COLUMNS} FROM equipment`).all<EquipmentRow>(),
    ]);
    return {
      projects: projects.results ?? [],
      systems: systems.results ?? [],
      equipment: equipment.results ?? [],
    };
  }
}

export class D1AttachmentStore implements AttachmentStore {
  constructor(private readonly db: D1Database) {}

  async upsert(a: AttachmentRow): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO attachments (${ATTACHMENT_COLUMNS})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        a.id,
        a.record_id,
        a.field_id,
        a.kind,
        a.image_key,
        a.caption,
        a.device_id,
        a.created_at,
      )
      .run();
  }

  async getById(id: string): Promise<AttachmentRow | null> {
    const row = await this.db
      .prepare(`SELECT ${ATTACHMENT_COLUMNS} FROM attachments WHERE id = ?`)
      .bind(id)
      .first<AttachmentRow>();
    return row ?? null;
  }

  async listByRecord(recordId: string): Promise<AttachmentRow[]> {
    const res = await this.db
      .prepare(`SELECT ${ATTACHMENT_COLUMNS} FROM attachments WHERE record_id = ?`)
      .bind(recordId)
      .all<AttachmentRow>();
    return res.results ?? [];
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
    if (this.rows.some((r) => r.id === sig.id)) return; // insert-once (§12)
    this.rows.push({ ...sig });
  }
  async getById(id: string): Promise<SignatureRow | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async listByRecord(recordId: string): Promise<SignatureRow[]> {
    return this.rows.filter((r) => r.record_id === recordId);
  }
}

export class MemoryAuditStore implements AuditStore {
  readonly rows: AuditRow[] = [];
  async add(entry: AuditRow): Promise<void> {
    if (this.rows.some((r) => r.id === entry.id)) return; // insert-once (§12)
    this.rows.push({ ...entry });
  }
  async getById(id: string): Promise<AuditRow | null> {
    return this.rows.find((r) => r.id === id) ?? null;
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

export class MemoryInstrumentStore implements InstrumentStore {
  readonly rows = new Map<string, InstrumentRow>();
  async upsert(row: InstrumentRow): Promise<void> {
    const existing = this.rows.get(row.id);
    // Last-write-wins, but a stale push never clobbers a newer row.
    if (existing && existing.updated_at > row.updated_at) return;
    this.rows.set(row.id, { ...row });
  }
  async list(): Promise<InstrumentRow[]> {
    return [...this.rows.values()].map((r) => ({ ...r }));
  }
}

export class MemoryRegistryStore implements RegistryStore {
  readonly projects = new Map<string, ProjectRow>();
  readonly systems = new Map<string, SystemRow>();
  readonly equipment = new Map<string, EquipmentRow>();

  private static put<T extends { id: string; updated_at: string }>(
    map: Map<string, T>,
    row: T,
  ): void {
    const existing = map.get(row.id);
    // Last-write-wins, but a stale push never clobbers a newer row.
    if (existing && existing.updated_at > row.updated_at) return;
    map.set(row.id, { ...row });
  }

  async upsertProject(row: ProjectRow): Promise<void> {
    MemoryRegistryStore.put(this.projects, row);
  }
  async upsertSystem(row: SystemRow): Promise<void> {
    MemoryRegistryStore.put(this.systems, row);
  }
  async upsertEquipment(row: EquipmentRow): Promise<void> {
    MemoryRegistryStore.put(this.equipment, row);
  }
  async list(): Promise<RegistrySnapshotRows> {
    return {
      projects: [...this.projects.values()].map((r) => ({ ...r })),
      systems: [...this.systems.values()].map((r) => ({ ...r })),
      equipment: [...this.equipment.values()].map((r) => ({ ...r })),
    };
  }
}

export class MemoryAttachmentStore implements AttachmentStore {
  readonly rows = new Map<string, AttachmentRow>();
  async upsert(row: AttachmentRow): Promise<void> {
    this.rows.set(row.id, { ...row }); // last-write-wins
  }
  async getById(id: string): Promise<AttachmentRow | null> {
    const r = this.rows.get(id);
    return r ? { ...r } : null;
  }
  async listByRecord(recordId: string): Promise<AttachmentRow[]> {
    return [...this.rows.values()].filter((r) => r.record_id === recordId);
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
