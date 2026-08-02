import type { AuditEntry } from "./audit";
import type { ChecklistDb } from "./db";

/**
 * Local persistence for the audit log. Append-only, exactly like the signatures
 * repo: `add` plus reads, no update or delete. The log is the evidence trail for
 * who changed a record's status and when (§9, Hard Rule #6).
 */
export class AuditRepo {
  constructor(private readonly db: ChecklistDb) {}

  /** Append an entry. Throws if the id already exists. */
  async add(entry: AuditEntry): Promise<void> {
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
