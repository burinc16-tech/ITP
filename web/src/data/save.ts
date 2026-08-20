import { isoClock, type ChecklistRecord, type Clock } from "./record";
import type { RecordsRepo } from "./records-repo";
import type { SignaturesRepo } from "./signatures-repo";
import type { SyncLayer } from "./sync";
import { isDeletableStatus, isLocked } from "./workflow";

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

export interface DeleteDeps extends SaveDeps {
  signatures: SignaturesRepo;
}

/**
 * The single delete path. Deletion is a soft-delete tombstone written through
 * the normal save/sync machinery — the row stays, flagged `deleted`, with a
 * fresh `updated_at`, so the deletion reaches the server and every other device
 * by last-write-wins instead of being resurrected by a stale push.
 *
 * Guarded twice against Hard Rule #6 (nothing signed is ever deleted): only a
 * draft/completed record with NO captured signatures may be tombstoned. The
 * server enforces the same rule, so a stale client cannot delete around it.
 */
export async function deleteRecord(deps: DeleteDeps, id: string): Promise<void> {
  const record = await deps.repo.get(id);
  if (!record || record.deleted) return; // already gone — idempotent (Hard Rule #3)
  if (!isDeletableStatus(record.status)) {
    throw new Error("Only a draft or completed record can be deleted; this one is evidence.");
  }
  if ((await deps.signatures.listByRecord(id)).length > 0) {
    throw new Error("This record is signed; signed evidence is never deleted.");
  }
  const clock = deps.clock ?? isoClock;
  const tombstone: ChecklistRecord = { ...record, deleted: true, updated_at: clock() };
  await deps.repo.upsert(tombstone);
  await deps.sync.push(tombstone);
}
