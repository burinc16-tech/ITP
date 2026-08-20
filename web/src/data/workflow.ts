import { isSignOffSection, type Signature, type SignatureStage, type Template } from "@schema";
import type { ChecklistRecord, RecordStatus } from "./record";
import { ROLE_LABELS, type Role } from "./roles";

/**
 * The record status workflow (SPEC §6). One pure state machine: `transition`
 * applies a legal move or throws, and `checkAction` reports whether a move is
 * currently allowed and why not — so the UI can show a disabled button with a
 * reason rather than hiding it. Transitions are gated by role (§9) and by the
 * signatures the step requires (§6): a step is unlocked only when every slot of
 * its stage is signed.
 */
export type WorkflowAction =
  | "complete"
  | "submit_for_witness"
  | "witness"
  | "accept"
  | "reject";

interface Rule {
  to: RecordStatus;
  role: Role;
  /** Signature stage that must be fully signed before the action. */
  stage?: SignatureStage;
  /** All required fields must be filled first. */
  needsFields?: boolean;
  /** The action requires a written reason. */
  needsReason?: boolean;
}

/** Legal moves keyed by action, each listing the source states it applies from. */
const RULES: Record<WorkflowAction, Partial<Record<RecordStatus, Rule>>> = {
  complete: {
    draft: { to: "completed", role: "site_engineer", stage: "contractor", needsFields: true },
  },
  submit_for_witness: {
    completed: { to: "submitted_for_witness", role: "qa_qc" },
  },
  witness: {
    submitted_for_witness: { to: "witnessed", role: "qa_qc", stage: "witness" },
  },
  accept: {
    witnessed: { to: "accepted", role: "qa_qc", stage: "client" },
  },
  reject: {
    completed: { to: "rejected", role: "qa_qc", needsReason: true },
    submitted_for_witness: { to: "rejected", role: "qa_qc", needsReason: true },
    witnessed: { to: "rejected", role: "qa_qc", needsReason: true },
  },
};

export const ACTION_LABELS: Record<WorkflowAction, string> = {
  complete: "Mark complete",
  submit_for_witness: "Submit for witness",
  witness: "Record witness",
  accept: "Accept",
  reject: "Reject",
};

const STAGE_LABELS: Record<SignatureStage, string> = {
  contractor: "Tested By",
  check: "Checked By",
  witness: "Witnessed By",
  client: "Accepted By",
};

/** A record is locked once accepted — read-only forever (Hard Rule #6, §6). */
export function isLocked(status: RecordStatus): boolean {
  return status === "accepted";
}

/** Field values are editable only while a draft (§6 — only draft is editable). */
export function fieldsEditable(status: RecordStatus): boolean {
  return status === "draft";
}

/**
 * Statuses a record may be deleted from — draft and completed only, and even
 * then only when it carries no signatures (checked where deletion happens).
 * Everything later is evidence: submitted/witnessed records were signed to get
 * there, and accepted/rejected are locked server-side (Hard Rule #6, §8).
 */
export function isDeletableStatus(status: RecordStatus): boolean {
  return status === "draft" || status === "completed";
}

export interface WorkflowContext {
  role: Role;
  satisfiedStages: ReadonlySet<SignatureStage>;
  fieldsComplete: boolean;
}

export interface ActionCheck {
  allowed: boolean;
  reason?: string;
}

/** Actions with a rule from this status, in display order. */
export function actionsFrom(status: RecordStatus): WorkflowAction[] {
  const order: WorkflowAction[] = [
    "complete",
    "submit_for_witness",
    "witness",
    "accept",
    "reject",
  ];
  return order.filter((a) => RULES[a][status] !== undefined);
}

/** Whether an action is currently permitted, with a reason when it is not. */
export function checkAction(
  status: RecordStatus,
  action: WorkflowAction,
  ctx: WorkflowContext,
): ActionCheck {
  const rule = RULES[action][status];
  if (!rule) return { allowed: false, reason: `Not available from ${status}.` };
  if (rule.role !== ctx.role) {
    return { allowed: false, reason: `Only ${ROLE_LABELS[rule.role]} can do this.` };
  }
  if (rule.needsFields && !ctx.fieldsComplete) {
    return { allowed: false, reason: "Fill all required fields first." };
  }
  if (rule.stage && !ctx.satisfiedStages.has(rule.stage)) {
    return {
      allowed: false,
      reason: `Capture the ${STAGE_LABELS[rule.stage]} signature first.`,
    };
  }
  return { allowed: true };
}

export interface TransitionResult {
  record: ChecklistRecord;
  from: RecordStatus;
  to: RecordStatus;
}

/**
 * Apply a transition, returning the updated record. Throws if the move is not
 * currently allowed, or if a reject has no reason. Pure — the clock and any
 * `context_snapshot` are supplied by the caller.
 */
export function transition(input: {
  record: ChecklistRecord;
  action: WorkflowAction;
  ctx: WorkflowContext;
  now: string;
  reason?: string;
}): TransitionResult {
  const { record, action, ctx, now, reason } = input;
  const rule = RULES[action][record.status];
  const check = checkAction(record.status, action, ctx);
  if (!rule || !check.allowed) {
    throw new Error(check.reason ?? "Illegal transition");
  }
  if (rule.needsReason && !reason?.trim()) {
    throw new Error("A reason is required to reject.");
  }
  const next: ChecklistRecord = {
    ...record,
    status: rule.to,
    completed_at: rule.to === "completed" ? now : record.completed_at,
  };
  return { record: next, from: record.status, to: rule.to };
}

/** Every signature slot in a template, across the footer and sign_off sections. */
export function collectSignatureSlots(template: Template): Signature[] {
  const slots: Signature[] = [];
  if (template.footer) slots.push(...template.footer.signatures);
  for (const section of template.sections) {
    if (isSignOffSection(section)) slots.push(...section.signatures);
  }
  return slots;
}

const ALL_STAGES: SignatureStage[] = ["contractor", "check", "witness", "client"];

/**
 * The stages whose signatures are fully captured. A stage with no declared slots
 * is satisfied vacuously, so a template that does not use a stage never blocks on
 * it.
 */
export function satisfiedStages(
  template: Template,
  signedSlotIds: ReadonlySet<string>,
): Set<SignatureStage> {
  const total: Record<SignatureStage, number> = { contractor: 0, check: 0, witness: 0, client: 0 };
  const signed: Record<SignatureStage, number> = { contractor: 0, check: 0, witness: 0, client: 0 };
  for (const slot of collectSignatureSlots(template)) {
    if (!slot.stage) continue;
    total[slot.stage] += 1;
    if (signedSlotIds.has(slot.id)) signed[slot.stage] += 1;
  }
  const out = new Set<SignatureStage>();
  for (const stage of ALL_STAGES) {
    if (signed[stage] === total[stage]) out.add(stage);
  }
  return out;
}
