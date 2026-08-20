/**
 * Project / System / Equipment entities (SPEC §4). Like records they are
 * local-first with client-generated UUIDv7 ids (Hard Rule #2). Unlike signatures
 * and the audit log these are editable reference data managed by a Project Admin
 * (§9), so the repo upserts rather than being append-only.
 *
 * The system type is named `SystemNode`, not `System`, to avoid shadowing.
 */
export type ProjectStatus = "open" | "closed";

export interface Project {
  id: string;
  code: string;
  name: string;
  client: string;
  status: ProjectStatus;
  created_at: string;
  closed_at: string | null;
  /** Last edit, for last-write-wins sync. Optional: rows predate the sync. */
  updated_at?: string;
}

export interface SystemNode {
  id: string;
  project_id: string;
  name: string;
  code: string;
  /** Parent system for a subsystem, or null for a top-level system. */
  parent_system_id: string | null;
  /** Last edit, for last-write-wins sync. Optional: rows predate the sync. */
  updated_at?: string;
}

export interface Equipment {
  id: string;
  project_id: string;
  system_id: string;
  tag: string;
  description: string;
  location: string;
  drawing_ref: string;
  /** Last edit, for last-write-wins sync. Optional: rows predate the sync. */
  updated_at?: string;
}

export function createProject(opts: {
  id: string;
  now: string;
  code: string;
  name: string;
  client: string;
}): Project {
  return {
    id: opts.id,
    code: opts.code,
    name: opts.name,
    client: opts.client,
    status: "open",
    created_at: opts.now,
    closed_at: null,
  };
}

export function createSystem(opts: {
  id: string;
  projectId: string;
  name: string;
  code: string;
  parentSystemId?: string | null;
}): SystemNode {
  return {
    id: opts.id,
    project_id: opts.projectId,
    name: opts.name,
    code: opts.code,
    parent_system_id: opts.parentSystemId ?? null,
  };
}

export function createEquipment(opts: {
  id: string;
  projectId: string;
  systemId: string;
  tag: string;
  description?: string;
  location?: string;
  drawingRef?: string;
}): Equipment {
  return {
    id: opts.id,
    project_id: opts.projectId,
    system_id: opts.systemId,
    tag: opts.tag,
    description: opts.description ?? "",
    location: opts.location ?? "",
    drawing_ref: opts.drawingRef ?? "",
  };
}
