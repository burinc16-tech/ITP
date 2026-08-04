import type { Attachment } from "./attachment";
import type { ChecklistDb } from "./db";

/**
 * Local persistence for photo attachments (SPEC §4, §8). Bytes stay in IndexedDB;
 * the record references them by id. Editable while a record is a draft — a photo
 * can be recaptioned or removed — so unlike signatures this repo is not
 * append-only. The form gates edits once the record is locked (§6).
 */
export class AttachmentsRepo {
  constructor(private readonly db: ChecklistDb) {}

  async add(attachment: Attachment): Promise<void> {
    await this.db.attachments.put(attachment);
  }

  async get(id: string): Promise<Attachment | undefined> {
    return this.db.attachments.get(id);
  }

  /** All attachments for one record, oldest first (capture order). */
  async listByRecord(recordId: string): Promise<Attachment[]> {
    const rows = await this.db.attachments.where("record_id").equals(recordId).toArray();
    rows.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    return rows;
  }

  async setCaption(id: string, caption: string): Promise<void> {
    await this.db.attachments.update(id, { caption });
  }

  async remove(id: string): Promise<void> {
    await this.db.attachments.delete(id);
  }
}
