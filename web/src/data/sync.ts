import type { ChecklistRecord } from "./record";

/**
 * The boundary between local writes and the API (SPEC §8, hard rule #1). The
 * form never calls the API directly — it writes to Dexie, then hands the record
 * to a SyncLayer. Phase 5 replaces the implementation with a durable queue
 * (retry, backoff, oldest-first); the interface stays the same.
 */
export interface SyncLayer {
  push(record: ChecklistRecord): Promise<void>;
  /**
   * Read the server's copy of a record, or null when unavailable/offline/local-only.
   * Used to reflect a remote change (e.g. a rejection made via a sign-off link)
   * back into the local store. A full durable pull/merge is Phase 5; this is a
   * best-effort read.
   */
  pull(id: string): Promise<ChecklistRecord | null>;
}

/**
 * Phase 1 sync: a pass-through with no queue and no network. It exists so the
 * boundary is real from day one — later phases slot a queue in behind this
 * method without touching the save path or the form.
 */
export class PassthroughSync implements SyncLayer {
  async push(_record: ChecklistRecord): Promise<void> {
    // Intentionally does nothing yet. This is where the Phase 5 outbox/queue and
    // the API push will live. Records are durable in Dexie regardless.
  }

  async pull(_id: string): Promise<ChecklistRecord | null> {
    // Local-only mode: there is no server to read from.
    return null;
  }
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

  async push(record: ChecklistRecord): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/api/records`, {
        method: "POST",
        headers: { "content-type": "application/json", ...this.authHeader() },
        body: JSON.stringify(record),
      });
    } catch (err) {
      // Local save already succeeded; retries are Phase 5.
      console.warn("sync push failed (kept locally)", err);
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
}
