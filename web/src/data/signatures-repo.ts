import type { ChecklistDb } from "./db";
import type { CapturedSignature } from "./signature";

/**
 * Local persistence for captured signatures. Deliberately append-only: it
 * exposes `add` and reads, but no update or delete. A signature is evidence and
 * must never be mutated or removed once written (SPEC §6, Hard Rule #6). Using
 * Dexie's `add` (not `put`) means re-adding the same id rejects rather than
 * silently overwriting, which keeps that guarantee at the storage layer.
 */
export class SignaturesRepo {
  constructor(private readonly db: ChecklistDb) {}

  /** Store a new signature. Throws if one with the same id already exists. */
  async add(signature: CapturedSignature): Promise<void> {
    await this.db.signatures.add(signature);
  }

  /** All signatures captured against a record, in insertion order. */
  async listByRecord(recordId: string): Promise<CapturedSignature[]> {
    return this.db.signatures.where("record_id").equals(recordId).toArray();
  }
}
