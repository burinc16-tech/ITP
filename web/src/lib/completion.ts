import type { Template } from "@schema";
import {
  headRecords,
  templateFor,
  type ChecklistRecord,
  type RecordStatus,
} from "../data/record";
import type { Project, SystemNode } from "../data/registry";

export interface TemplateCompletion {
  template_version_id: string;
  title: string;
  total: number;
  accepted: number;
}

export interface CompletionSummary {
  /** One head record per ITR (revisions collapsed). */
  total: number;
  accepted: number;
  /** accepted / total as a whole percentage; 0 when there are no records. */
  percentComplete: number;
  byStatus: Record<RecordStatus, number>;
  byTemplate: TemplateCompletion[];
}

const ZERO_COUNTS = (): Record<RecordStatus, number> => ({
  draft: 0,
  completed: 0,
  submitted_for_witness: 0,
  witnessed: 0,
  accepted: 0,
  rejected: 0,
});

/**
 * Completion across the store (SPEC §10 screen 2). Counts one head record per
 * ITR so revisions don't inflate totals; "complete" means `accepted` — the
 * finished, locked evidence state (§6). Grouped by template, the only dimension
 * that exists until project/system entities are modelled.
 */
export function completionSummary(
  records: ChecklistRecord[],
  templates: Template[],
): CompletionSummary {
  const heads = headRecords(records);
  const byStatus = ZERO_COUNTS();
  const perTemplate = new Map<string, TemplateCompletion>();

  for (const r of heads) {
    byStatus[r.status] += 1;
    const key = r.template_version_id;
    const entry =
      perTemplate.get(key) ??
      {
        template_version_id: key,
        title: templateFor(r, templates)?.title ?? key,
        total: 0,
        accepted: 0,
      };
    entry.total += 1;
    if (r.status === "accepted") entry.accepted += 1;
    perTemplate.set(key, entry);
  }

  const total = heads.length;
  const accepted = byStatus.accepted;
  return {
    total,
    accepted,
    percentComplete: total === 0 ? 0 : Math.round((accepted / total) * 100),
    byStatus,
    byTemplate: [...perTemplate.values()],
  };
}

/** Completion counts grouped by a record scope key (SPEC §10 screen 2). */
export interface ScopeCompletion {
  key: string;
  label: string;
  total: number;
  accepted: number;
}

const UNASSIGNED = "__unassigned__";

function tallyScope(
  records: ChecklistRecord[],
  keyOf: (r: ChecklistRecord) => string | null,
  labelOf: (id: string) => string,
): ScopeCompletion[] {
  const map = new Map<string, ScopeCompletion>();
  for (const r of headRecords(records)) {
    const id = keyOf(r) ?? UNASSIGNED;
    const entry =
      map.get(id) ??
      {
        key: id,
        label: id === UNASSIGNED ? "Unassigned" : labelOf(id),
        total: 0,
        accepted: 0,
      };
    entry.total += 1;
    if (r.status === "accepted") entry.accepted += 1;
    map.set(id, entry);
  }
  return [...map.values()];
}

/** Completion per project (heads only; null-project records under "Unassigned"). */
export function completionByProject(
  records: ChecklistRecord[],
  projects: Project[],
): ScopeCompletion[] {
  const name = new Map(projects.map((p) => [p.id, p.name]));
  return tallyScope(records, (r) => r.project_id, (id) => name.get(id) ?? id);
}

/** Completion per system (heads only; null-system records under "Unassigned"). */
export function completionBySystem(
  records: ChecklistRecord[],
  systems: SystemNode[],
): ScopeCompletion[] {
  const name = new Map(systems.map((s) => [s.id, s.name]));
  return tallyScope(records, (r) => r.system_id, (id) => name.get(id) ?? id);
}
