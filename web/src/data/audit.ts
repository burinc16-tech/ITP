import type { Role } from "./roles";

/**
 * One audit-log entry (SPEC §4 `AuditLog`, §9). Every status change is recorded
 * here, attributed to the acting role and user. The log is append-only — it is
 * the evidence trail, so entries are never edited or deleted (Hard Rule #6).
 */
export interface AuditEntry {
  /** UUIDv7, generated on the client. */
  id: string;
  record_id: string;
  /** Account that acted (STUB_USER until real auth). */
  user: string | null;
  /** Role the user was acting as (§9). */
  role: Role;
  /** The workflow action, e.g. "complete" or "reject". */
  action: string;
  /** Status before the change (null for non-transition entries). */
  before: string | null;
  /** Status after the change. */
  after: string | null;
  /** Rejection reason or other note. */
  reason: string | null;
  /** UTC ISO string (CLAUDE.md convention). */
  at: string;
}

/** Build an audit entry. Pure — id and time are passed in. */
export function createAuditEntry(opts: {
  id: string;
  recordId: string;
  user: string | null;
  role: Role;
  action: string;
  before: string | null;
  after: string | null;
  reason?: string | null;
  now: string;
}): AuditEntry {
  return {
    id: opts.id,
    record_id: opts.recordId,
    user: opts.user,
    role: opts.role,
    action: opts.action,
    before: opts.before,
    after: opts.after,
    reason: opts.reason ?? null,
    at: opts.now,
  };
}
