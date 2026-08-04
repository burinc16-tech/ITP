import type { Attachment } from "./attachment";
import type { AttachmentsRepo } from "./attachments-repo";
import type { AuditEntry } from "./audit";
import { isoClock } from "./record";
import type { ChecklistRecord } from "./record";
import type { AuditRepo } from "./audit-repo";
import type { OutboxRepo, OutboxEntry } from "./outbox";
import type { RecordsRepo } from "./records-repo";
import type { CapturedSignature } from "./signature";
import type { SignaturesRepo } from "./signatures-repo";
import type { AttachmentMeta, PushResult, SyncLayer } from "./sync";

/**
 * The raw network transport the queue drains against. Unlike the eager `ApiSync`
 * (which swallows failures so a keystroke-save never throws), every method here
 * **throws on a network/transport failure** — the queue must know whether a push
 * actually reached the server, so it can retry rather than silently drop the
 * outbox entry. A resolved call means the server responded.
 */
export interface Transport {
  /** Upsert a record; resolves with the server outcome (throws on network failure). */
  pushRecord(record: ChecklistRecord): Promise<{ applied: boolean; conflict: boolean }>;
  /** Insert-once a signature (throws on network failure). */
  pushSignature(signature: CapturedSignature): Promise<void>;
  /** Insert-once an audit entry (throws on network failure). */
  pushAudit(entry: AuditEntry): Promise<void>;
  /** Upsert a photo attachment (throws on network failure). */
  pushAttachment(attachment: Attachment): Promise<void>;
  /** Best-effort read of the server's record copy, or null. */
  pull(id: string): Promise<ChecklistRecord | null>;
  /** Best-effort read of a record's photo metadata, or null (§8 backfill). */
  pullAttachments(recordId: string): Promise<AttachmentMeta[] | null>;
  /** Best-effort fetch of one attachment's image bytes, or null. */
  pullAttachmentImage(recordId: string, attachmentId: string): Promise<Blob | null>;
}

export interface QueuedSyncDeps {
  transport: Transport;
  outbox: OutboxRepo;
  records: RecordsRepo;
  signatures: SignaturesRepo;
  audit: AuditRepo;
  attachments: AttachmentsRepo;
  clock?: () => string;
  /**
   * Fired with the record id when a queued record push is refused as a lock
   * conflict (§8). The queue can't tell the caller synchronously — the conflict
   * surfaces whenever the drain reaches that entry — so the app wires this to the
   * warn-and-reconcile path (see record-form's reconcileConflict).
   */
  onConflict?: (recordId: string) => void;
  /**
   * Kick a drain after every enqueue. On (default) in production; tests turn it
   * off to drive `drain()` deterministically.
   */
  autoDrain?: boolean;
  /**
   * Fired whenever the pending set may have changed — an enqueue, a delivery, or
   * a reschedule. The app wires this to the "pending unsynced" indicator (§8) so
   * it re-reads `pendingCount` without polling.
   */
  onChange?: () => void;
}

type DeliverOutcome = "ok" | "conflict" | "gone";

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Durable, offline-tolerant SyncLayer (SPEC §8). Every mutation is written to the
 * outbox and drained oldest-first with exponential backoff. It slots in behind
 * the same SyncLayer interface `saveRecord` and the form already use — the
 * boundary was built for exactly this swap, so no caller changes.
 *
 * `push` returns immediately (`conflict: false`): the record is durable in Dexie
 * and enqueued, and any conflict is discovered later during the drain and routed
 * through `onConflict`. Durability is the local store plus this queue, never the
 * eager network call (SPEC §12).
 */
export class QueuedSync implements SyncLayer {
  private readonly clock: () => string;
  private readonly autoDrain: boolean;
  private draining = false;

  constructor(private readonly deps: QueuedSyncDeps) {
    this.clock = deps.clock ?? isoClock;
    this.autoDrain = deps.autoDrain ?? true;
  }

  async push(record: ChecklistRecord): Promise<PushResult> {
    await this.deps.outbox.enqueue("record", record.id, this.clock());
    this.changed();
    this.kick();
    return { conflict: false };
  }

  async pushSignature(signature: CapturedSignature): Promise<void> {
    await this.deps.outbox.enqueue("signature", signature.id, this.clock());
    this.changed();
    this.kick();
  }

  async pushAudit(entry: AuditEntry): Promise<void> {
    await this.deps.outbox.enqueue("audit", entry.id, this.clock());
    this.changed();
    this.kick();
  }

  async pushAttachment(attachment: Attachment): Promise<void> {
    await this.deps.outbox.enqueue("attachment", attachment.id, this.clock());
    this.changed();
    this.kick();
  }

  pull(id: string): Promise<ChecklistRecord | null> {
    return this.deps.transport.pull(id);
  }

  pullAttachments(recordId: string): Promise<AttachmentMeta[] | null> {
    return this.deps.transport.pullAttachments(recordId);
  }

  pullAttachmentImage(recordId: string, attachmentId: string): Promise<Blob | null> {
    return this.deps.transport.pullAttachmentImage(recordId, attachmentId);
  }

  /** Pending pushes not yet delivered — the §8 on-screen count. */
  pendingCount(): Promise<number> {
    return this.deps.outbox.pendingCount();
  }

  /**
   * Drain the outbox oldest-first. Each entry: deliver, then drop on success,
   * conflict, or a vanished entity; on a network failure, reschedule it with
   * backoff and stop (the rest are almost certainly unreachable too — a later
   * kick or interval retries). Re-entrancy-guarded so overlapping kicks are safe.
   */
  async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      for (;;) {
        const now = this.clock();
        const [entry] = await this.deps.outbox.due(now);
        if (!entry) break;
        try {
          const outcome = await this.deliver(entry);
          if (outcome === "conflict") this.deps.onConflict?.(entry.target_id);
          await this.deps.outbox.remove(entry.id);
          this.changed();
        } catch (err) {
          await this.deps.outbox.reschedule(entry, now, errText(err));
          this.changed();
          break;
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private async deliver(entry: OutboxEntry): Promise<DeliverOutcome> {
    switch (entry.kind) {
      case "record": {
        const record = await this.deps.records.get(entry.target_id);
        if (!record) return "gone";
        const res = await this.deps.transport.pushRecord(record);
        return res.conflict ? "conflict" : "ok";
      }
      case "signature": {
        const signature = await this.deps.signatures.get(entry.target_id);
        if (!signature) return "gone";
        await this.deps.transport.pushSignature(signature);
        return "ok";
      }
      case "audit": {
        const audit = await this.deps.audit.get(entry.target_id);
        if (!audit) return "gone";
        await this.deps.transport.pushAudit(audit);
        return "ok";
      }
      case "attachment": {
        const attachment = await this.deps.attachments.get(entry.target_id);
        if (!attachment) return "gone";
        await this.deps.transport.pushAttachment(attachment);
        return "ok";
      }
    }
  }

  private kick(): void {
    if (this.autoDrain) void this.drain().catch(() => {});
  }

  private changed(): void {
    this.deps.onChange?.();
  }
}

/**
 * What the on-screen pending indicator (SPEC §8) needs from the sync layer: the
 * current count and a way to retry now. QueuedSync satisfies it; local-only mode
 * has no queue, so the indicator simply isn't rendered.
 */
export interface SyncStatusSource {
  pendingCount(): Promise<number>;
  drain(): Promise<void>;
}
