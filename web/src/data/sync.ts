import type { AuditEntry } from "./audit";
import type { ChecklistRecord } from "./record";
import type { CapturedSignature } from "./signature";

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

export interface SyncLayer {
  /** Push a record. Resolves with whether the server reported a lock conflict (§8). */
  push(record: ChecklistRecord): Promise<PushResult>;
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
}
