import type { ChecklistDb } from "./db";

/**
 * The Phase 5 sync outbox (SPEC §8). Every local mutation enqueues a pending
 * push here; the queue drains it oldest-first with backoff. Durability lives in
 * the local store plus this outbox — the eager push is only an optimization
 * (SPEC §12), so nothing is lost if a push is deferred, retried, or replayed.
 *
 * The entry id is deterministic — `${kind}:${target_id}` — so re-enqueuing the
 * same entity coalesces onto one row. A record edited ten times offline is one
 * pending push (the drain reads its latest version); insert-once evidence has a
 * unique target id, so each signature/audit entry gets its own row.
 */
export type OutboxKind = "record" | "signature" | "audit";

export interface OutboxEntry {
  /** `${kind}:${target_id}` — deterministic, so re-enqueue coalesces. */
  id: string;
  kind: OutboxKind;
  /** The entity's client id (record / signature / audit entry). */
  target_id: string;
  /** When first enqueued. Drain order is oldest `enqueued_at` first. */
  enqueued_at: string;
  /** Failed delivery attempts so far; drives the backoff. */
  attempts: number;
  /** Not eligible to send until now ≥ this. Backoff gate. */
  next_attempt_at: string;
  /** Last transport error, for the pending-items UI; null while fresh. */
  last_error: string | null;
}

const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 5 * 60_000; // 5 minutes

/**
 * Exponential backoff for the nth failed attempt (1-based): 1s, 2s, 4s, … capped
 * at 5 min. Pure so the queue and its tests share one schedule.
 */
export function backoffMs(attempts: number): number {
  if (attempts <= 0) return 0;
  const grown = BACKOFF_BASE_MS * 2 ** (attempts - 1);
  return Math.min(grown, BACKOFF_MAX_MS);
}

const entryId = (kind: OutboxKind, targetId: string): string => `${kind}:${targetId}`;

const iso = (ms: number): string => new Date(ms).toISOString();

export class OutboxRepo {
  constructor(private readonly db: ChecklistDb) {}

  /**
   * Enqueue (or coalesce onto) a pending push for one entity. A re-enqueue keeps
   * the original `enqueued_at` (fair ordering — it has been waiting) but clears
   * the backoff so the newest content is retried immediately.
   */
  async enqueue(kind: OutboxKind, targetId: string, now: string): Promise<void> {
    const id = entryId(kind, targetId);
    const existing = await this.db.outbox.get(id);
    await this.db.outbox.put({
      id,
      kind,
      target_id: targetId,
      enqueued_at: existing?.enqueued_at ?? now,
      attempts: 0,
      next_attempt_at: now,
      last_error: null,
    });
  }

  /** Entries eligible to send at `now` (backoff elapsed), oldest-first. */
  async due(now: string): Promise<OutboxEntry[]> {
    const rows = await this.db.outbox
      .orderBy("enqueued_at")
      .filter((e) => e.next_attempt_at <= now)
      .toArray();
    return rows;
  }

  /** Remove a delivered (or unresolvable) entry. */
  async remove(id: string): Promise<void> {
    await this.db.outbox.delete(id);
  }

  /** Record a failed attempt and push the next eligible time out by the backoff. */
  async reschedule(entry: OutboxEntry, now: string, error: string): Promise<void> {
    const attempts = entry.attempts + 1;
    await this.db.outbox.put({
      ...entry,
      attempts,
      next_attempt_at: iso(new Date(now).getTime() + backoffMs(attempts)),
      last_error: error,
    });
  }

  /** How many pushes are still pending (the §8 on-screen count). */
  async pendingCount(): Promise<number> {
    return this.db.outbox.count();
  }

  /** All pending entries, oldest-first — for the pending-items UI. */
  async all(): Promise<OutboxEntry[]> {
    return this.db.outbox.orderBy("enqueued_at").toArray();
  }
}
