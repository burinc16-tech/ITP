import type { Attachment } from "./attachment";
import type { AuditEntry } from "./audit";
import type { Instrument } from "./instrument";
import type { ChecklistRecord } from "./record";
import type { Equipment, Project, SystemNode } from "./registry";
import type { CapturedSignature } from "./signature";
import type { Transport } from "./sync-queue";

/**
 * The boundary between local writes and the API (SPEC §8, hard rule #1). The
 * form never calls the API directly — it writes to Dexie, then hands the record
 * (and its append-only evidence) to a SyncLayer. Phase 5 replaces the
 * implementation with a durable queue (retry, backoff, oldest-first); the
 * interface stays the same.
 *
 * Records upsert last-write-wins; signatures and audit entries are insert-once
 * append-only evidence (SPEC §12) — the server drops an identical replay and
 * rejects a same-id write whose content differs.
 */
export interface PushResult {
  /**
   * True only when the server refused the write because the record is locked
   * server-side (accepted/rejected, §8) — the caller should warn and reconcile.
   * Offline/network failures are NOT conflicts: the record stays durable locally
   * for the queue to retry, so those resolve to `false`.
   */
  conflict: boolean;
}

/** Server-side metadata for one photo attachment (SPEC §8), for cross-device backfill. */
export interface AttachmentMeta {
  id: string;
  field_id: string;
  caption: string;
  device_id: string;
  created_at: string;
}

/** The server's copy of the project registry (SPEC §4, §10 screen 8). */
export interface RegistrySnapshot {
  projects: Project[];
  systems: SystemNode[];
  equipment: Equipment[];
}

export interface SyncLayer {
  /** Push a record. Resolves with whether the server reported a lock conflict (§8). */
  push(record: ChecklistRecord): Promise<PushResult>;
  /**
   * Read every record the server holds, or null when unavailable/offline/
   * local-only. The register's durable pull (§8): merged into the local store on
   * login so a cleared browser gets its synced records back. Best-effort.
   */
  pullRecords(): Promise<ChecklistRecord[] | null>;
  /**
   * Read the server's copy of a record, or null when unavailable/offline/local-only.
   * Used to reflect a remote change (e.g. a rejection made via a sign-off link)
   * back into the local store. A full durable pull/merge is Phase 5; this is a
   * best-effort read.
   */
  pull(id: string): Promise<ChecklistRecord | null>;
  /** Push a captured on-device signature (SPEC §6 path A). Best-effort. */
  pushSignature(signature: CapturedSignature): Promise<void>;
  /** Push an audit entry the client authored (SPEC §9). Best-effort. */
  pushAudit(entry: AuditEntry): Promise<void>;
  /** Push a captured photo attachment (SPEC §8). Best-effort. */
  pushAttachment(attachment: Attachment): Promise<void>;
  /**
   * Read the server's photo list for a record, or null when unavailable/offline.
   * Used to backfill photos captured on another device (§8). Best-effort.
   */
  pullAttachments(recordId: string): Promise<AttachmentMeta[] | null>;
  /** Fetch one attachment's image bytes (with auth), or null. Best-effort. */
  pullAttachmentImage(recordId: string, attachmentId: string): Promise<Blob | null>;
  /**
   * Push one calibration-register instrument (SPEC §10 screen 9). Upsert,
   * last-write-wins on `updated_at`; a removal rides as a tombstone. Best-effort.
   */
  pushInstrument(instrument: Instrument): Promise<void>;
  /**
   * Read the server's register, tombstones included, or null when
   * unavailable/offline/local-only. Best-effort.
   */
  pullInstruments(): Promise<Instrument[] | null>;
  /**
   * Push one project-registry entry (SPEC §4, §10 screen 8). Upsert,
   * last-write-wins on `updated_at`, like instruments. Best-effort.
   */
  pushProject(project: Project): Promise<void>;
  pushSystem(system: SystemNode): Promise<void>;
  pushEquipment(equipment: Equipment): Promise<void>;
  /**
   * Read the server's whole project registry, or null when unavailable/offline/
   * local-only. Best-effort.
   */
  pullRegistry(): Promise<RegistrySnapshot | null>;
}

/**
 * Phase 1 sync: a pass-through with no queue and no network. It exists so the
 * boundary is real from day one — later phases slot a queue in behind this
 * method without touching the save path or the form.
 */
export class PassthroughSync implements SyncLayer {
  async push(_record: ChecklistRecord): Promise<PushResult> {
    // Intentionally does nothing yet. This is where the Phase 5 outbox/queue and
    // the API push will live. Records are durable in Dexie regardless.
    return { conflict: false };
  }

  async pull(_id: string): Promise<ChecklistRecord | null> {
    // Local-only mode: there is no server to read from.
    return null;
  }

  async pushSignature(_signature: CapturedSignature): Promise<void> {
    // No queue, no network — the signature is durable in Dexie.
  }

  async pushAudit(_entry: AuditEntry): Promise<void> {
    // No queue, no network — the entry is durable in Dexie.
  }

  async pushAttachment(_attachment: Attachment): Promise<void> {
    // No queue, no network — the photo is durable in Dexie.
  }

  async pullAttachments(_recordId: string): Promise<AttachmentMeta[] | null> {
    // Local-only mode: there is no server to read from.
    return null;
  }

  async pullAttachmentImage(_recordId: string, _attachmentId: string): Promise<Blob | null> {
    return null;
  }

  async pushInstrument(_instrument: Instrument): Promise<void> {
    // No queue, no network — the instrument is durable in Dexie.
  }

  async pullInstruments(): Promise<Instrument[] | null> {
    // Local-only mode: there is no server to read from.
    return null;
  }

  async pushProject(_project: Project): Promise<void> {
    // No queue, no network — the entry is durable in Dexie.
  }

  async pushSystem(_system: SystemNode): Promise<void> {
    // No queue, no network — the entry is durable in Dexie.
  }

  async pushEquipment(_equipment: Equipment): Promise<void> {
    // No queue, no network — the entry is durable in Dexie.
  }

  async pullRegistry(): Promise<RegistrySnapshot | null> {
    // Local-only mode: there is no server to read from.
    return null;
  }

  async pullRecords(): Promise<ChecklistRecord[] | null> {
    // Local-only mode: there is no server to read from.
    return null;
  }
}

/** Best-effort authenticated GET returning parsed JSON, or null on any failure. */
async function getJson<T>(url: string, headers: Record<string, string>): Promise<T | null> {
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (err) {
    console.warn("attachment list failed", err);
    return null;
  }
}

/** Best-effort authenticated GET returning the response as a Blob, or null. */
async function getBlob(url: string, headers: Record<string, string>): Promise<Blob | null> {
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    return await res.blob();
  } catch (err) {
    console.warn("attachment image fetch failed", err);
    return null;
  }
}

/** Base64 `data:` URL for a blob, so a signature PNG rides in a JSON body. */
async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `data:${blob.type || "image/png"};base64,${btoa(binary)}`;
}

/** A bearer token, or a getter for the current session token (task 4). */
export type TokenSource = string | (() => string | null);

const resolveToken = (source: TokenSource): string | null =>
  typeof source === "function" ? source() : source;

/**
 * Online sync push to the Worker API (SPEC §3). Best-effort: the record is
 * already durable in Dexie (local-first), so a failed or offline push is
 * swallowed — the durable retry queue is Phase 5, not this task. Auth is the
 * signed-in user's session token (task 4); a token getter lets the token change
 * across login/logout without rebuilding the sync layer.
 */
export class ApiSync implements SyncLayer {
  constructor(
    private readonly baseUrl: string,
    private readonly token: TokenSource,
  ) {}

  private authHeader(): Record<string, string> {
    const token = resolveToken(this.token);
    return token ? { authorization: `Bearer ${token}` } : {};
  }

  async push(record: ChecklistRecord): Promise<PushResult> {
    try {
      const res = await fetch(`${this.baseUrl}/api/records`, {
        method: "POST",
        headers: { "content-type": "application/json", ...this.authHeader() },
        body: JSON.stringify(record),
      });
      // A non-2xx (e.g. 401/500) is a transport/auth problem, not a lock conflict.
      if (!res.ok) return { conflict: false };
      const body = (await res.json().catch(() => ({}))) as { conflict?: boolean };
      return { conflict: body.conflict === true };
    } catch (err) {
      // Local save already succeeded; retries are Phase 5.
      console.warn("sync push failed (kept locally)", err);
      return { conflict: false };
    }
  }

  async pull(id: string): Promise<ChecklistRecord | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/records/${id}`, {
        headers: this.authHeader(),
      });
      if (!res.ok) return null;
      return (await res.json()) as ChecklistRecord;
    } catch (err) {
      console.warn("sync pull failed", err);
      return null;
    }
  }

  async pushSignature(signature: CapturedSignature): Promise<void> {
    try {
      const image = await blobToDataUrl(signature.image);
      await fetch(`${this.baseUrl}/api/records/${signature.record_id}/signatures`, {
        method: "POST",
        headers: { "content-type": "application/json", ...this.authHeader() },
        body: JSON.stringify({
          id: signature.id,
          slot_id: signature.slot_id,
          role: signature.role,
          name: signature.name,
          company: signature.company,
          method: signature.method,
          signed_by_user: signature.signed_by_user,
          device_id: signature.device_id,
          signed_at: signature.signed_at,
          image,
        }),
      });
    } catch (err) {
      // Local save already succeeded; retries are Phase 5.
      console.warn("signature push failed (kept locally)", err);
    }
  }

  async pushAudit(entry: AuditEntry): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/api/records/${entry.record_id}/audit`, {
        method: "POST",
        headers: { "content-type": "application/json", ...this.authHeader() },
        body: JSON.stringify(entry),
      });
    } catch (err) {
      console.warn("audit push failed (kept locally)", err);
    }
  }

  async pushAttachment(attachment: Attachment): Promise<void> {
    try {
      const image = await blobToDataUrl(attachment.image);
      await fetch(`${this.baseUrl}/api/records/${attachment.record_id}/attachments`, {
        method: "POST",
        headers: { "content-type": "application/json", ...this.authHeader() },
        body: JSON.stringify(attachmentBody(attachment, image)),
      });
    } catch (err) {
      console.warn("attachment push failed (kept locally)", err);
    }
  }

  pullAttachments(recordId: string): Promise<AttachmentMeta[] | null> {
    return getJson(`${this.baseUrl}/api/records/${recordId}/attachments`, this.authHeader());
  }

  pullAttachmentImage(recordId: string, attachmentId: string): Promise<Blob | null> {
    return getBlob(
      `${this.baseUrl}/api/records/${recordId}/attachments/${attachmentId}`,
      this.authHeader(),
    );
  }

  async pushInstrument(instrument: Instrument): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/api/instruments`, {
        method: "POST",
        headers: { "content-type": "application/json", ...this.authHeader() },
        body: JSON.stringify(instrumentBody(instrument)),
      });
    } catch (err) {
      // Local save already succeeded; the next syncDown re-pushes it.
      console.warn("instrument push failed (kept locally)", err);
    }
  }

  async pullInstruments(): Promise<Instrument[] | null> {
    const body = await getJson<{ instruments: ServerInstrument[] }>(
      `${this.baseUrl}/api/instruments`,
      this.authHeader(),
    );
    return body?.instruments ? body.instruments.map(fromServerInstrument) : null;
  }

  async pushProject(project: Project): Promise<void> {
    await this.pushRegistryEntry("projects", projectBody(project));
  }

  async pushSystem(system: SystemNode): Promise<void> {
    await this.pushRegistryEntry("systems", systemBody(system));
  }

  async pushEquipment(equipment: Equipment): Promise<void> {
    await this.pushRegistryEntry("equipment", equipmentBody(equipment));
  }

  private async pushRegistryEntry(kind: string, body: Record<string, unknown>): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/api/registry/${kind}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...this.authHeader() },
        body: JSON.stringify(body),
      });
    } catch (err) {
      // Local save already succeeded; the next syncDown re-pushes it.
      console.warn("registry push failed (kept locally)", err);
    }
  }

  async pullRegistry(): Promise<RegistrySnapshot | null> {
    const body = await getJson<ServerRegistry>(`${this.baseUrl}/api/registry`, this.authHeader());
    return body ? fromServerRegistry(body) : null;
  }

  async pullRecords(): Promise<ChecklistRecord[] | null> {
    const body = await getJson<{ records: ChecklistRecord[] }>(
      `${this.baseUrl}/api/records`,
      this.authHeader(),
    );
    return body?.records ?? null;
  }
}

/** An instrument row as the API returns it — SQLite has no boolean, so 0/1. */
interface ServerInstrument {
  id: string;
  serial_no?: string;
  description?: string;
  cal_cert_url?: string;
  cert_no?: string;
  cal_date?: string;
  cal_due_date?: string;
  updated_at?: string;
  deleted?: number;
}

function fromServerInstrument(row: ServerInstrument): Instrument {
  return {
    id: row.id,
    serial_no: row.serial_no ?? "",
    description: row.description ?? "",
    cal_cert_url: row.cal_cert_url ?? "",
    cert_no: row.cert_no ?? "",
    cal_date: row.cal_date ?? "",
    cal_due_date: row.cal_due_date ?? "",
    updated_at: row.updated_at,
    deleted: row.deleted === 1,
  };
}

/** JSON body for an instrument push; the tombstone crosses the wire as 0/1. */
function instrumentBody(instrument: Instrument): Record<string, unknown> {
  return {
    id: instrument.id,
    serial_no: instrument.serial_no,
    description: instrument.description,
    cal_cert_url: instrument.cal_cert_url,
    cert_no: instrument.cert_no ?? "",
    cal_date: instrument.cal_date,
    cal_due_date: instrument.cal_due_date,
    updated_at: instrument.updated_at ?? new Date().toISOString(),
    deleted: instrument.deleted ? 1 : 0,
  };
}

/**
 * The project registry as the API returns it (SPEC §4, §10 screen 8) — SQLite
 * has no boolean, so tombstones cross the wire as `deleted: 0/1`.
 */
interface ServerRegistry {
  projects?: Array<Omit<Project, "status" | "deleted"> & { status?: string; deleted?: number }>;
  systems?: Array<Omit<SystemNode, "deleted"> & { deleted?: number }>;
  equipment?: Array<Omit<Equipment, "deleted"> & { deleted?: number }>;
}

function fromServerRegistry(body: ServerRegistry): RegistrySnapshot {
  return {
    projects: (body.projects ?? []).map((p) => ({
      ...p,
      status: p.status === "closed" ? ("closed" as const) : ("open" as const),
      closed_at: p.closed_at ?? null,
      deleted: p.deleted === 1,
    })),
    systems: (body.systems ?? []).map((s) => ({
      ...s,
      parent_system_id: s.parent_system_id ?? null,
      deleted: s.deleted === 1,
    })),
    equipment: (body.equipment ?? []).map((e) => ({ ...e, deleted: e.deleted === 1 })),
  };
}

/**
 * JSON bodies for registry pushes. `updated_at` is stamped here for rows written
 * before the registry synced at all, so an old row is still a valid push; a
 * tombstone rides as `deleted: 1`, like instruments.
 */
function projectBody(p: Project): Record<string, unknown> {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    client: p.client,
    status: p.status,
    created_at: p.created_at,
    closed_at: p.closed_at,
    updated_at: p.updated_at ?? new Date().toISOString(),
    deleted: p.deleted ? 1 : 0,
  };
}

function systemBody(s: SystemNode): Record<string, unknown> {
  return {
    id: s.id,
    project_id: s.project_id,
    name: s.name,
    code: s.code,
    parent_system_id: s.parent_system_id,
    updated_at: s.updated_at ?? new Date().toISOString(),
    deleted: s.deleted ? 1 : 0,
  };
}

function equipmentBody(e: Equipment): Record<string, unknown> {
  return {
    id: e.id,
    project_id: e.project_id,
    system_id: e.system_id,
    tag: e.tag,
    description: e.description,
    location: e.location,
    drawing_ref: e.drawing_ref,
    updated_at: e.updated_at ?? new Date().toISOString(),
    deleted: e.deleted ? 1 : 0,
  };
}

/** JSON body for an attachment push — the image rides as a `data:` URL. */
function attachmentBody(attachment: Attachment, image: string): Record<string, unknown> {
  return {
    id: attachment.id,
    field_id: attachment.field_id,
    caption: attachment.caption,
    mime: attachment.mime,
    device_id: attachment.device_id,
    created_at: attachment.created_at,
    image,
  };
}

/**
 * Late lock-conflict bus. QueuedSync discovers a lock conflict (§8) during a
 * drain — long after the originating save returned `{ conflict: false }` — so it
 * can't tell the caller synchronously. The queue publishes the record id here and
 * whichever RecordForm is showing that record subscribes and reconciles to the
 * server copy. Kept framework-agnostic so the data layer stays UI-free.
 */
export type ConflictListener = (recordId: string) => void;
const conflictListeners = new Set<ConflictListener>();

/** Broadcast a record id whose queued push was refused as a lock conflict. */
export function publishConflict(recordId: string): void {
  for (const listener of conflictListeners) listener(recordId);
}

/** Subscribe to late lock-conflicts; returns an unsubscribe. */
export function subscribeConflicts(listener: ConflictListener): () => void {
  conflictListeners.add(listener);
  return () => {
    conflictListeners.delete(listener);
  };
}

/**
 * Outbox-changed bus. QueuedSync fires this whenever the pending set may have
 * changed — an enqueue, a delivery, or a reschedule — so the on-screen "pending
 * unsynced" indicator (SPEC §8) can re-read the count without polling. Also
 * framework-agnostic, so the data layer carries no UI dependency.
 */
export type PendingListener = () => void;
const pendingListeners = new Set<PendingListener>();

/** Signal that the outbox changed; the indicator re-reads its count. */
export function publishPending(): void {
  for (const listener of pendingListeners) listener();
}

/** Subscribe to outbox changes; returns an unsubscribe. */
export function subscribePending(listener: PendingListener): () => void {
  pendingListeners.add(listener);
  return () => {
    pendingListeners.delete(listener);
  };
}

/**
 * Non-2xx statuses the queue must stop retrying: the request reached the server
 * and replaying it won't change the outcome — a malformed body (400), or an
 * append-only entry whose fingerprint will never match the stored one (409
 * evidence conflict, §12). Rescheduling these forever would poison the outbox,
 * since the drain stops at the first still-failing entry (head-of-line). Every
 * other failure — offline, 401 (token refresh), 404 (parent record not synced
 * yet), 5xx — throws so the queue retries with backoff.
 */
const TERMINAL_STATUSES: ReadonlySet<number> = new Set([400, 409]);

/**
 * Classify a transport response. Returns "delivered" on 2xx; "terminal" on a
 * non-retryable status (logged, so the caller drops the entry rather than
 * looping); throws otherwise so the queue reschedules with backoff.
 */
function classifyResponse(res: Response, what: string): "delivered" | "terminal" {
  if (res.ok) return "delivered";
  if (TERMINAL_STATUSES.has(res.status)) {
    console.error(`${what} rejected (${res.status}) — dropping from the sync queue`);
    return "terminal";
  }
  throw new Error(`${what} failed: ${res.status}`);
}

/**
 * The network transport the Phase 5 queue (QueuedSync) drains against. Same
 * Worker endpoints as ApiSync, but with the opposite error contract: every
 * method **throws on a retryable failure** (offline, 401/404/5xx) so the queue
 * knows the push didn't land and reschedules it. A resolved call means the write
 * is durably on the server (or terminally rejected and safe to drop) — never a
 * silently-swallowed offline. Auth is the session token getter, as with ApiSync.
 */
export class ApiTransport implements Transport {
  constructor(
    private readonly baseUrl: string,
    private readonly token: TokenSource,
  ) {}

  private authHeader(): Record<string, string> {
    const token = resolveToken(this.token);
    return token ? { authorization: `Bearer ${token}` } : {};
  }

  async pushRecord(record: ChecklistRecord): Promise<{ applied: boolean; conflict: boolean }> {
    const res = await fetch(`${this.baseUrl}/api/records`, {
      method: "POST",
      headers: { "content-type": "application/json", ...this.authHeader() },
      body: JSON.stringify(record),
    });
    if (classifyResponse(res, "record push") === "terminal") {
      return { applied: false, conflict: false };
    }
    const body = (await res.json().catch(() => ({}))) as {
      applied?: boolean;
      conflict?: boolean;
    };
    return { applied: body.applied !== false, conflict: body.conflict === true };
  }

  async pushSignature(signature: CapturedSignature): Promise<void> {
    const image = await blobToDataUrl(signature.image);
    const res = await fetch(
      `${this.baseUrl}/api/records/${signature.record_id}/signatures`,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...this.authHeader() },
        body: JSON.stringify({
          id: signature.id,
          slot_id: signature.slot_id,
          role: signature.role,
          name: signature.name,
          company: signature.company,
          method: signature.method,
          signed_by_user: signature.signed_by_user,
          device_id: signature.device_id,
          signed_at: signature.signed_at,
          image,
        }),
      },
    );
    classifyResponse(res, "signature push");
  }

  async pushAudit(entry: AuditEntry): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/records/${entry.record_id}/audit`, {
      method: "POST",
      headers: { "content-type": "application/json", ...this.authHeader() },
      body: JSON.stringify(entry),
    });
    classifyResponse(res, "audit push");
  }

  async pushAttachment(attachment: Attachment): Promise<void> {
    const image = await blobToDataUrl(attachment.image);
    const res = await fetch(
      `${this.baseUrl}/api/records/${attachment.record_id}/attachments`,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...this.authHeader() },
        body: JSON.stringify(attachmentBody(attachment, image)),
      },
    );
    classifyResponse(res, "attachment push");
  }

  async pull(id: string): Promise<ChecklistRecord | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/records/${id}`, {
        headers: this.authHeader(),
      });
      if (!res.ok) return null;
      return (await res.json()) as ChecklistRecord;
    } catch (err) {
      // Pull is best-effort (SPEC §8) — a failed read just means no reconcile now.
      console.warn("sync pull failed", err);
      return null;
    }
  }

  pullAttachments(recordId: string): Promise<AttachmentMeta[] | null> {
    return getJson(`${this.baseUrl}/api/records/${recordId}/attachments`, this.authHeader());
  }

  pullAttachmentImage(recordId: string, attachmentId: string): Promise<Blob | null> {
    return getBlob(
      `${this.baseUrl}/api/records/${recordId}/attachments/${attachmentId}`,
      this.authHeader(),
    );
  }

  /** Throws on a retryable failure, per this class's contract. */
  async pushInstrument(instrument: Instrument): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/instruments`, {
      method: "POST",
      headers: { "content-type": "application/json", ...this.authHeader() },
      body: JSON.stringify(instrumentBody(instrument)),
    });
    classifyResponse(res, "instrument push");
  }

  async pullInstruments(): Promise<Instrument[] | null> {
    const body = await getJson<{ instruments: ServerInstrument[] }>(
      `${this.baseUrl}/api/instruments`,
      this.authHeader(),
    );
    return body?.instruments ? body.instruments.map(fromServerInstrument) : null;
  }

  /** Throws on a retryable failure, per this class's contract. */
  async pushProject(project: Project): Promise<void> {
    await this.pushRegistryEntry("projects", projectBody(project), "project push");
  }

  async pushSystem(system: SystemNode): Promise<void> {
    await this.pushRegistryEntry("systems", systemBody(system), "system push");
  }

  async pushEquipment(equipment: Equipment): Promise<void> {
    await this.pushRegistryEntry("equipment", equipmentBody(equipment), "equipment push");
  }

  private async pushRegistryEntry(
    kind: string,
    body: Record<string, unknown>,
    what: string,
  ): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/registry/${kind}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...this.authHeader() },
      body: JSON.stringify(body),
    });
    classifyResponse(res, what);
  }

  async pullRegistry(): Promise<RegistrySnapshot | null> {
    const body = await getJson<ServerRegistry>(`${this.baseUrl}/api/registry`, this.authHeader());
    return body ? fromServerRegistry(body) : null;
  }

  async pullRecords(): Promise<ChecklistRecord[] | null> {
    const body = await getJson<{ records: ChecklistRecord[] }>(
      `${this.baseUrl}/api/records`,
      this.authHeader(),
    );
    return body?.records ?? null;
  }
}
