import type { AuditEntry } from "./audit";
import type { ChecklistDb } from "./db";

/** Content identity of an audit entry — every field except the id. */
function fingerprint(e: AuditEntry): string {
  return JSON.stringify([
    e.record_id,
    e.user,
    e.role,
    e.action,
    e.before,
    e.after,
    e.reason,
    e.at,
  ]);
}

/**
 * Local persistence for the audit log. Append-only, exactly like the signatures
 * repo: `add` plus reads, no update or delete. The log is the evidence trail for
 * who changed a record's status and when (§9, Hard Rule #6).
 *
 * `add` is insert-once (SPEC §12): an identical re-add under the same id is a
 * no-op success so a replayed sync push is safe; a same-id entry whose content
 * differs is an evidence conflict and throws rather than overwriting.
 */
export class AuditRepo {
  constructor(private readonly db: ChecklistDb) {}

  /**
   * Append an entry. Identical re-add → no-op; same id with different content →
   * throws (the log is never rewritten).
   */
  async add(entry: AuditEntry): Promise<void> {
    const existing = await this.db.audit_log.get(entry.id);
    if (existing) {
      if (fingerprint(existing) !== fingerprint(entry)) {
        throw new Error(
          "A different audit entry already exists with this id; the log is never overwritten.",
        );
      }
      return; // identical replay — insert-once no-op (SPEC §12)
    }
    await this.db.audit_log.add(entry);
  }

  /** All entries for a record, oldest first. */
  async listByRecord(recordId: string): Promise<AuditEntry[]> {
    const rows = await this.db.audit_log
      .where("record_id")
      .equals(recordId)
      .toArray();
    rows.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    return rows;
  }

  /** The most recent entries across all records, newest first (dashboard). */
  async recent(limit = 20): Promise<AuditEntry[]> {
    return this.db.audit_log.orderBy("at").reverse().limit(limit).toArray();
  }
}
