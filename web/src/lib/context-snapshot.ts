import { isStandardSection, type Template } from "@schema";
import type { Equipment, Project, SystemNode } from "../data/registry";
import { buildVarMap, interpolate, type VarMap } from "./interpolate";
import type { RecordValues } from "./values";

/** The registry entities a record is scoped to, resolved at signing time. */
export interface ScopeContext {
  project?: Project | null;
  system?: SystemNode | null;
  equipment?: Equipment | null;
}

/** Denormalized project/system/equipment names frozen into the record (§2). */
export type ScopeSnapshot = {
  project: { code: string; name: string; client: string } | null;
  system: { code: string; name: string } | null;
  equipment: {
    tag: string;
    description: string;
    location: string;
    drawing_ref: string;
  } | null;
};

/**
 * The resolved context copied into a record at `completed` (SPEC §2, §5.1): the
 * variable values, the step descriptions with every `{{variable}}` expanded to
 * its literal text, and — copied so a later rename never alters the signed
 * evidence (§2) — the linked project, system, and equipment names.
 */
export type ContextSnapshotData = {
  resolved_at: string;
  variables: VarMap;
  header: Record<string, string>;
  descriptions: Record<string, string>;
  scope: ScopeSnapshot;
};

function snapshotScope(scope: ScopeContext | undefined): ScopeSnapshot {
  const project = scope?.project ?? null;
  const system = scope?.system ?? null;
  const equipment = scope?.equipment ?? null;
  return {
    project: project
      ? { code: project.code, name: project.name, client: project.client }
      : null,
    system: system ? { code: system.code, name: system.name } : null,
    equipment: equipment
      ? {
          tag: equipment.tag,
          description: equipment.description,
          location: equipment.location,
          drawing_ref: equipment.drawing_ref,
        }
      : null,
  };
}

export function buildContextSnapshot(
  template: Template,
  values: RecordValues,
  now: string,
  scope?: ScopeContext,
): ContextSnapshotData {
  const variables = buildVarMap(template.variables, values.variables);
  const descriptions: Record<string, string> = {};
  for (const section of template.sections) {
    if (isStandardSection(section)) {
      for (const row of section.rows) {
        descriptions[row.id] = interpolate(row.description, variables);
      }
    }
  }
  return {
    resolved_at: now,
    variables,
    header: { ...values.header },
    descriptions,
    scope: snapshotScope(scope),
  };
}
