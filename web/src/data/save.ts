import { isoClock, type ChecklistRecord, type Clock } from "./record";
import type { RecordsRepo } from "./records-repo";
import type { SyncLayer } from "./sync";
import { isLocked } from "./workflow";

export interface SaveDeps {
  repo: RecordsRepo;
  sync: SyncLayer;
  clock?: Clock;
}

export interface SaveResult {
  /** The saved record (already durable in Dexie), with its stamped `updated_at`. */
  record: ChecklistRecord;
  /**
   * True when the sync push was refused because the server copy is locked
   * (accepted/rejected, §8). The local write still happened; the caller should
   * warn and reconcile against the server rather than trust its local copy.
   */
  conflict: boolean;
}

/**
 * The single save path (hard rule #1 / SPEC §8): stamp `updated_at`, write to
 * Dexie, then hand off to the sync layer. Local-first — the record is durable
 * once `repo.upsert` resolves, before sync runs. Idempotent: saving the same id
 * replaces its row rather than creating a duplicate.
 *
 * An `accepted` record is locked forever (§6, Hard Rule #6): if the stored copy
 * is already accepted, the write is refused. The accept transition itself still
 * goes through — at that point the stored copy is `witnessed`, not yet accepted.
 *
 * The push outcome is returned so the caller can react to a server-side lock
 * conflict (§8) — the local write is durable regardless.
 */
export async function saveRecord(
  deps: SaveDeps,
  record: ChecklistRecord,
): Promise<SaveResult> {
  const prior = await deps.repo.get(record.id);
  if (prior && isLocked(prior.status)) {
    throw new Error("This record is accepted and locked; it cannot be changed.");
  }
  const clock = deps.clock ?? isoClock;
  const next: ChecklistRecord = { ...record, updated_at: clock() };
  await deps.repo.upsert(next);
  const { conflict } = await deps.sync.push(next);
  return { record: next, conflict };
}
