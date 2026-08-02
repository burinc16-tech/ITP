import type { Template } from "@schema";
import { emptyValues, type RecordValues } from "../lib/values";

/** Record lifecycle states (SPEC §6). Phase 1 only reaches `draft`. */
export type RecordStatus =
  | "draft"
  | "completed"
  | "submitted_for_witness"
  | "witnessed"
  | "accepted"
  | "rejected";

/**
 * Resolved context copied into the record at signing (SPEC §2, §5.1). Null in
 * Phase 1 — it is populated at the `completed` transition, which needs the
 * server and is out of Phase 1 scope.
 */
export type ContextSnapshot = Record<string, unknown>;

/**
 * One filled ITR (SPEC §4). Only the fields Phase 1 needs are populated; the
 * rest are carried as nullable so the shape is stable for later phases.
 *
 * Named `ChecklistRecord`, not `Record`, so it never shadows TypeScript's
 * built-in `Record<K, V>` utility type.
 */
export interface ChecklistRecord {
  /** UUIDv7, generated on the client. Never a database sequence. */
  id: string;
  template_version_id: string;
  project_id: string | null;
  system_id: string | null;
  scope_type: "equipment" | "location";
  equipment_id: string | null;
  location_id: string | null;
  /** Display value assigned server-side at `draft → completed`; null is valid. */
  serial_no: string | null;
  status: RecordStatus;
  /** Record revision, 1-based. A rejected record is corrected as a new rev (§6). */
  rev: number;
  /** Id of the record this one supersedes (the rejected rev it corrects), or null. */
  supersedes: string | null;
  values: RecordValues;
  context_snapshot: ContextSnapshot | null;
  created_by: string | null;
  /** UTC ISO strings (CLAUDE.md convention). */
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

/** Returns a monotonic UTC ISO timestamp string. */
export type Clock = () => string;

export const isoClock: Clock = () => new Date().toISOString();

/** Stub identity until real auth arrives (out of Phase 1 scope). */
export const STUB_USER = "stub-user";

/**
 * The template version a record fills. Until the TemplateVersion table exists
 * (Phase 2), it is derived from the template's code and rev, e.g. "HLT@A".
 */
export function templateVersionId(t: Pick<Template, "code" | "rev">): string {
  return `${t.code}@${t.rev}`;
}

/** The template a record was filled against, matched by version id. */
export function templateFor(
  record: Pick<ChecklistRecord, "template_version_id">,
  templates: Template[],
): Template | undefined {
  return templates.find(
    (t) => templateVersionId(t) === record.template_version_id,
  );
}

/**
 * The head of each revision chain — records no later revision supersedes. One
 * head per ITR, so counting or deriving over heads never double-counts a
 * corrected record against its superseded rev (§6).
 */
export function headRecords(records: ChecklistRecord[]): ChecklistRecord[] {
  const superseded = new Set<string>();
  for (const r of records) if (r.supersedes) superseded.add(r.supersedes);
  return records.filter((r) => !superseded.has(r.id));
}

/** Build a fresh draft for a template. Pure — ids and time are passed in. */
export function createDraft(
  template: Template,
  opts: {
    id: string;
    now: string;
    createdBy: string | null;
    /** Registry scope (§4), populated by the New-record dialog; null when unset. */
    projectId?: string | null;
    systemId?: string | null;
    equipmentId?: string | null;
    scopeType?: "equipment" | "location";
  },
): ChecklistRecord {
  return {
    id: opts.id,
    template_version_id: templateVersionId(template),
    project_id: opts.projectId ?? null,
    system_id: opts.systemId ?? null,
    scope_type: opts.scopeType ?? "equipment",
    equipment_id: opts.equipmentId ?? null,
    location_id: null,
    serial_no: null,
    status: "draft",
    rev: 1,
    supersedes: null,
    values: emptyValues(template),
    context_snapshot: null,
    created_by: opts.createdBy,
    created_at: opts.now,
    updated_at: opts.now,
    completed_at: null,
  };
}

/**
 * Correct a rejected record by producing its next revision (SPEC §6): a fresh
 * editable draft that copies the rejected values, links back via `supersedes`,
 * and increments `rev`. Signatures and the resolved snapshot are NOT carried
 * over — the new rev is re-filled and re-signed from scratch. Pure: id and time
 * are passed in. The rejected record itself is never touched (Hard Rule #6).
 */
export function reviseRejected(
  record: ChecklistRecord,
  opts: { id: string; now: string; createdBy: string | null },
): ChecklistRecord {
  if (record.status !== "rejected") {
    throw new Error("Only a rejected record can be revised.");
  }
  return {
    ...record,
    id: opts.id,
    status: "draft",
    rev: record.rev + 1,
    supersedes: record.id,
    serial_no: null,
    values: structuredClone(record.values),
    context_snapshot: null,
    created_by: opts.createdBy,
    created_at: opts.now,
    updated_at: opts.now,
    completed_at: null,
  };
}
