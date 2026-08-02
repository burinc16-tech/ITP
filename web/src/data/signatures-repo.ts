import type { ChecklistDb } from "./db";
import type { CapturedSignature } from "./signature";

/**
 * Metadata identity of an on-device signature. Excludes the image blob: a
 * client-side replay carries the same blob, and byte-level tamper detection is
 * enforced server-side where the raw PNG is available (SPEC §12). Any change to a
 * signer-visible field changes the fingerprint.
 */
function fingerprint(s: CapturedSignature): string {
  return JSON.stringify([
    s.record_id,
    s.slot_id,
    s.role,
    s.name,
    s.company,
    s.method,
    s.signed_by_user,
    s.device_id,
    s.signed_at,
  ]);
}

/**
 * Local persistence for captured signatures. Deliberately append-only: it
 * exposes `add` and reads, but no update or delete. A signature is evidence and
 * must never be mutated or removed once written (SPEC §6, Hard Rule #6).
 *
 * `add` is insert-once (SPEC §12): re-adding an identical signature under the
 * same id is a no-op success, so the Phase 5 sync queue can replay a write whose
 * ack was lost. A same-id write whose content differs is an evidence conflict and
 * throws rather than overwriting — the tamper/bug tripwire that keeps Rule #6
 * verifiable, not merely assumed.
 */
export class SignaturesRepo {
  constructor(private readonly db: ChecklistDb) {}

  /**
   * Store a signature. Identical re-add → no-op; same id with different content
   * → throws (evidence is never overwritten).
   */
  async add(signature: CapturedSignature): Promise<void> {
    const existing = await this.db.signatures.get(signature.id);
    if (existing) {
      if (fingerprint(existing) !== fingerprint(signature)) {
        throw new Error(
          "A different signature already exists with this id; signed evidence is never overwritten.",
        );
      }
      return; // identical replay — insert-once no-op (SPEC §12)
    }
    await this.db.signatures.add(signature);
  }

  /** One signature by id, or undefined — used by the sync queue to load a push. */
  async get(id: string): Promise<CapturedSignature | undefined> {
    return this.db.signatures.get(id);
  }

  /** All signatures captured against a record, in insertion order. */
  async listByRecord(recordId: string): Promise<CapturedSignature[]> {
    return this.db.signatures.where("record_id").equals(recordId).toArray();
  }
}
