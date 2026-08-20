import type { ChecklistDb } from "./db";
import type { ChecklistRecord } from "./record";

/**
 * Local persistence for records. Every write is an idempotent upsert keyed by
 * the client id (hard rule #3): `put` replaces the row for that id, so replaying
 * the same mutation is safe. No API calls happen here — that is the sync layer.
 */
export class RecordsRepo {
  constructor(private readonly db: ChecklistDb) {}

  async upsert(record: ChecklistRecord): Promise<void> {
    await this.db.records.put(record);
  }

  async get(id: string): Promise<ChecklistRecord | undefined> {
    return this.db.records.get(id);
  }

  async list(): Promise<ChecklistRecord[]> {
    return this.db.records.toArray();
  }

  /**
   * Merge the server's records into the local store, newest copy winning per id
   * (the §8 durable pull). A local record with unsynced edits carries a newer
   * `updated_at` than the server's copy, so it is never clobbered — the outbox
   * pushes it up instead. Returns how many local rows were written.
   */
  async mergeRemote(remote: ChecklistRecord[]): Promise<number> {
    let written = 0;
    for (const record of remote) {
      const mine = await this.db.records.get(record.id);
      if (!mine || mine.updated_at < record.updated_at) {
        await this.db.records.put(record);
        written += 1;
      }
    }
    return written;
  }

  /** The most recently updated draft for a template version, for resume. */
  async latestDraft(
    templateVersionId: string,
  ): Promise<ChecklistRecord | undefined> {
    const drafts = await this.db.records
      .where("template_version_id")
      .equals(templateVersionId)
      .and((r) => r.status === "draft")
      .toArray();
    drafts.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
    return drafts[0];
  }

  /** The record that superseded `recordId` (its next revision), if any (§6). */
  async bySupersedes(recordId: string): Promise<ChecklistRecord | undefined> {
    return this.db.records.where("supersedes").equals(recordId).first();
  }

  /**
   * The most recently updated rejected record for a template version that has
   * not yet been revised. Lets resume land on a rejected record so it can be
   * corrected, instead of silently minting a blank draft over it (§6).
   */
  async latestOpenRejected(
    templateVersionId: string,
  ): Promise<ChecklistRecord | undefined> {
    const rejected = await this.db.records
      .where("template_version_id")
      .equals(templateVersionId)
      .and((r) => r.status === "rejected")
      .toArray();
    rejected.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
    for (const record of rejected) {
      const successor = await this.bySupersedes(record.id);
      if (!successor) return record;
    }
    return undefined;
  }
}
