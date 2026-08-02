import { isoClock, type ChecklistRecord, type Clock } from "./record";
import type { RecordsRepo } from "./records-repo";
import type { SyncLayer } from "./sync";
import { isLocked } from "./workflow";

export interface SaveDeps {
  repo: RecordsRepo;
  sync: SyncLayer;
  clock?: Clock;
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
 */
export async function saveRecord(
  deps: SaveDeps,
  record: ChecklistRecord,
): Promise<ChecklistRecord> {
  const prior = await deps.repo.get(record.id);
  if (prior && isLocked(prior.status)) {
    throw new Error("This record is accepted and locked; it cannot be changed.");
  }
  const clock = deps.clock ?? isoClock;
  const next: ChecklistRecord = { ...record, updated_at: clock() };
  await deps.repo.upsert(next);
  await deps.sync.push(next);
  return next;
}
