import Dexie, { type Table } from "dexie";
import type { Attachment } from "./attachment";
import type { AuditEntry } from "./audit";
import type { Instrument } from "./instrument";
import type { OutboxEntry } from "./outbox";
import type { ChecklistRecord } from "./record";
import type { Equipment, Project, SystemNode } from "./registry";
import type { CapturedSignature } from "./signature";

/**
 * Local-first store (SPEC §8). Records are written here first; the sync layer
 * pushes to the API separately. The primary key is the client-generated id;
 * secondary indexes support resume-by-template and the later register views.
 *
 * Signatures are a separate table (SPEC §4 models them as their own entity) so
 * their PNG blobs stay off the frequently autosaved record row, and they are
 * append-only in practice — the repo never updates or deletes them (§6, Hard
 * Rule #6). Indexed by `record_id` to read all signatures for one record.
 */
export class ChecklistDb extends Dexie {
  records!: Table<ChecklistRecord, string>;
  signatures!: Table<CapturedSignature, string>;
  audit_log!: Table<AuditEntry, string>;
  projects!: Table<Project, string>;
  systems!: Table<SystemNode, string>;
  equipment!: Table<Equipment, string>;
  /** Phase 5 sync outbox: one pending push per entity, drained oldest-first (§8). */
  outbox!: Table<OutboxEntry, string>;
  /** Calibration register: test instruments and cert expiry (§10 screen 9). */
  instruments!: Table<Instrument, string>;
  /** Photo attachments: image blobs captured against a record field (§4, §8). */
  attachments!: Table<Attachment, string>;

  constructor(name = "itp-itr") {
    super(name);
    this.version(1).stores({
      records: "id, status, template_version_id, updated_at",
    });
    this.version(2).stores({
      records: "id, status, template_version_id, updated_at",
      signatures: "id, record_id, slot_id",
    });
    this.version(3).stores({
      records: "id, status, template_version_id, updated_at",
      signatures: "id, record_id, slot_id",
      audit_log: "id, record_id, at",
    });
    // `supersedes` indexed so a record's successor revision is queryable (§6).
    this.version(4).stores({
      records: "id, status, template_version_id, updated_at, supersedes",
      signatures: "id, record_id, slot_id",
      audit_log: "id, record_id, at",
    });
    // Project registry (§4, §10 screen 8).
    this.version(5).stores({
      records: "id, status, template_version_id, updated_at, supersedes",
      signatures: "id, record_id, slot_id",
      audit_log: "id, record_id, at",
      projects: "id, code",
      systems: "id, project_id, parent_system_id",
      equipment: "id, project_id, system_id, tag",
    });
    // Phase 5 sync outbox (§8). `enqueued_at` indexed for oldest-first draining,
    // `next_attempt_at` for backoff gating.
    this.version(6).stores({
      records: "id, status, template_version_id, updated_at, supersedes",
      signatures: "id, record_id, slot_id",
      audit_log: "id, record_id, at",
      projects: "id, code",
      systems: "id, project_id, parent_system_id",
      equipment: "id, project_id, system_id, tag",
      outbox: "id, kind, enqueued_at, next_attempt_at",
    });
    // Calibration register (§10 screen 9). `cal_due_date` indexed so the register
    // can surface soonest-expiring instruments first.
    this.version(7).stores({
      records: "id, status, template_version_id, updated_at, supersedes",
      signatures: "id, record_id, slot_id",
      audit_log: "id, record_id, at",
      projects: "id, code",
      systems: "id, project_id, parent_system_id",
      equipment: "id, project_id, system_id, tag",
      outbox: "id, kind, enqueued_at, next_attempt_at",
      instruments: "id, serial_no, cal_due_date",
    });
    // Photo attachments (§4, §8). `record_id` indexed to load a record's photos,
    // `field_id` to group them by the row they evidence.
    this.version(8).stores({
      records: "id, status, template_version_id, updated_at, supersedes",
      signatures: "id, record_id, slot_id",
      audit_log: "id, record_id, at",
      projects: "id, code",
      systems: "id, project_id, parent_system_id",
      equipment: "id, project_id, system_id, tag",
      outbox: "id, kind, enqueued_at, next_attempt_at",
      instruments: "id, serial_no, cal_due_date",
      attachments: "id, record_id, field_id",
    });
  }
}
