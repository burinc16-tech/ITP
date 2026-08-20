import { describe, it, expect } from "vitest";
import { parseTemplate } from "@schema";
import rawTemplate from "../../../spec/templates/heat-load-test.json";
import { createAttachment, type Attachment } from "./attachment";
import { AttachmentsRepo } from "./attachments-repo";
import { createAuditEntry, type AuditEntry } from "./audit";
import { AuditRepo } from "./audit-repo";
import { ChecklistDb } from "./db";
import type { Instrument } from "./instrument";
import { OutboxRepo } from "./outbox";
import { createDraft, type ChecklistRecord } from "./record";
import { RecordsRepo } from "./records-repo";
import { createSignature, type CapturedSignature } from "./signature";
import { SignaturesRepo } from "./signatures-repo";
import { QueuedSync, type Transport } from "./sync-queue";
import { uuidv7 } from "./uuidv7";

const template = parseTemplate(rawTemplate);

/** A transport that records deliveries and can be scripted to fail or conflict. */
class FakeTransport implements Transport {
  readonly records: string[] = [];
  readonly signatures: string[] = [];
  readonly audits: string[] = [];
  readonly attachments: string[] = [];
  readonly instruments: string[] = [];
  failNext = 0;
  readonly conflictIds = new Set<string>();

  private maybeFail(): void {
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error("offline");
    }
  }
  async pushRecord(r: ChecklistRecord): Promise<{ applied: boolean; conflict: boolean }> {
    this.maybeFail();
    this.records.push(r.id);
    return { applied: true, conflict: this.conflictIds.has(r.id) };
  }
  async pushSignature(s: CapturedSignature): Promise<void> {
    this.maybeFail();
    this.signatures.push(s.id);
  }
  async pushAudit(a: AuditEntry): Promise<void> {
    this.maybeFail();
    this.audits.push(a.id);
  }
  async pushAttachment(a: Attachment): Promise<void> {
    this.maybeFail();
    this.attachments.push(a.id);
  }
  async pull(): Promise<ChecklistRecord | null> {
    return null;
  }
  async pullAttachments(): Promise<null> {
    return null;
  }
  async pullAttachmentImage(): Promise<Blob | null> {
    return null;
  }
  async pushInstrument(i: Instrument): Promise<void> {
    this.maybeFail();
    this.instruments.push(i.id);
  }
  async pullInstruments(): Promise<Instrument[] | null> {
    return null;
  }
  async pushProject(): Promise<void> {
    this.maybeFail();
  }
  async pushSystem(): Promise<void> {
    this.maybeFail();
  }
  async pushEquipment(): Promise<void> {
    this.maybeFail();
  }
  async pullRegistry(): Promise<null> {
    return null;
  }
  async pullRecords(): Promise<ChecklistRecord[] | null> {
    return null;
  }
}

function harness() {
  const db = new ChecklistDb(`test-${uuidv7()}`);
  const records = new RecordsRepo(db);
  const signatures = new SignaturesRepo(db);
  const audit = new AuditRepo(db);
  const attachments = new AttachmentsRepo(db);
  const outbox = new OutboxRepo(db);
  const transport = new FakeTransport();
  const conflicts: string[] = [];
  let changes = 0;
  let t = 0;
  const clock = () => new Date(1_700_000_000_000 + t).toISOString();
  const advance = (ms: number) => {
    t += ms;
  };
  const queue = new QueuedSync({
    transport,
    outbox,
    records,
    signatures,
    audit,
    attachments,
    clock,
    autoDrain: false,
    onConflict: (id) => conflicts.push(id),
    onChange: () => {
      changes += 1;
    },
  });
  return {
    records,
    signatures,
    audit,
    attachments,
    outbox,
    transport,
    queue,
    conflicts,
    advance,
    clock,
    changes: () => changes,
  };
}

function draft(now: string): ChecklistRecord {
  return createDraft(template, { id: uuidv7(), now, createdBy: "u" });
}

describe("QueuedSync", () => {
  it("enqueues on push and delivers on drain", async () => {
    const h = harness();
    const r = draft(h.clock());
    await h.records.upsert(r);

    await h.queue.push(r);
    expect(await h.queue.pendingCount()).toBe(1);

    await h.queue.drain();
    expect(h.transport.records).toEqual([r.id]);
    expect(await h.queue.pendingCount()).toBe(0);
  });

  it("drains oldest-first", async () => {
    const h = harness();
    const a = draft(h.clock());
    await h.records.upsert(a);
    await h.queue.push(a);
    h.advance(1_000);
    const b = draft(h.clock());
    await h.records.upsert(b);
    await h.queue.push(b);

    await h.queue.drain();
    expect(h.transport.records).toEqual([a.id, b.id]);
  });

  it("reschedules with backoff and stops on a network failure, then retries when due", async () => {
    const h = harness();
    const r = draft(h.clock());
    await h.records.upsert(r);
    await h.queue.push(r);

    h.transport.failNext = 1;
    await h.queue.drain();
    expect(h.transport.records).toEqual([]); // failed, kept
    expect(await h.queue.pendingCount()).toBe(1);
    expect((await h.outbox.all())[0]!.attempts).toBe(1);

    // Within the 1s backoff window: not yet due.
    await h.queue.drain();
    expect(h.transport.records).toEqual([]);

    // Past the backoff: the retry succeeds and the entry clears.
    h.advance(1_000);
    await h.queue.drain();
    expect(h.transport.records).toEqual([r.id]);
    expect(await h.queue.pendingCount()).toBe(0);
  });

  it("surfaces a lock conflict via onConflict and drops the entry", async () => {
    const h = harness();
    const r = draft(h.clock());
    await h.records.upsert(r);
    await h.queue.push(r);
    h.transport.conflictIds.add(r.id);

    await h.queue.drain();
    expect(h.conflicts).toEqual([r.id]);
    expect(await h.queue.pendingCount()).toBe(0); // can't push a locked record
  });

  it("drops an entry whose entity has vanished, without calling the transport", async () => {
    const h = harness();
    await h.outbox.enqueue("record", "ghost", h.clock());

    await h.queue.drain();
    expect(h.transport.records).toEqual([]);
    expect(await h.queue.pendingCount()).toBe(0);
  });

  it("delivers queued signatures and audit entries", async () => {
    const h = harness();
    const r = draft(h.clock());
    await h.records.upsert(r);
    const sig = createSignature({
      id: uuidv7(),
      recordId: r.id,
      slotId: "sig_tested",
      role: "Tested by",
      name: "A. Engineer",
      company: "Kenyon Pte Ltd",
      image: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
      signedByUser: "u",
      deviceId: "d",
      now: h.clock(),
    });
    await h.signatures.add(sig);
    await h.queue.pushSignature(sig);
    const entry = createAuditEntry({
      id: uuidv7(),
      recordId: r.id,
      user: "u",
      role: "qa_qc",
      action: "complete",
      before: "draft",
      after: "completed",
      now: h.clock(),
    });
    await h.audit.add(entry);
    await h.queue.pushAudit(entry);

    await h.queue.drain();
    expect(h.transport.signatures).toEqual([sig.id]);
    expect(h.transport.audits).toEqual([entry.id]);
  });

  it("fires onChange on enqueue and on delivery, so the indicator can re-read", async () => {
    const h = harness();
    const r = draft(h.clock());
    await h.records.upsert(r);

    await h.queue.push(r);
    expect(h.changes()).toBe(1); // enqueue

    await h.queue.drain();
    expect(h.changes()).toBe(2); // delivery (entry removed)
  });

  it("fires onChange when a failed push is rescheduled", async () => {
    const h = harness();
    const r = draft(h.clock());
    await h.records.upsert(r);
    await h.queue.push(r); // change #1

    h.transport.failNext = 1;
    await h.queue.drain(); // reschedule → change #2
    expect(h.changes()).toBe(2);
    expect(await h.queue.pendingCount()).toBe(1);
  });

  it("delivers a queued photo attachment", async () => {
    const h = harness();
    const r = draft(h.clock());
    await h.records.upsert(r);
    const attachment = createAttachment({
      id: uuidv7(),
      recordId: r.id,
      fieldId: "ph_01",
      image: new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }),
      deviceId: "d",
      now: h.clock(),
    });
    await h.attachments.add(attachment);
    await h.queue.pushAttachment(attachment);

    await h.queue.drain();
    expect(h.transport.attachments).toEqual([attachment.id]);
    expect(await h.queue.pendingCount()).toBe(0);
  });

  it("coalesces repeated record pushes into a single delivery", async () => {
    const h = harness();
    const r = draft(h.clock());
    await h.records.upsert(r);

    await h.queue.push(r);
    await h.queue.push({ ...r }); // e.g. a later autosave of the same record
    expect(await h.queue.pendingCount()).toBe(1);

    await h.queue.drain();
    expect(h.transport.records).toEqual([r.id]); // delivered once
  });
});
