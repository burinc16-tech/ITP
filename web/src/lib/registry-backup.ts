import { z } from "zod";
import type { Equipment, Project, SystemNode } from "../data/registry";

/**
 * Export / restore file for the project registry (SPEC §4).
 *
 * Projects, systems and equipment are the one part of the app with no server
 * copy: records sync, the registry does not. Until it does, this file is the
 * only way a project survives a cleared browser, and the only way to carry one
 * to a second device. Validated with Zod on the way back in, like template JSON
 * — a file picked by hand is exactly where a wrong file gets chosen.
 */

export const BACKUP_FORMAT = "itp-itr-registry";
export const BACKUP_VERSION = 1;

const projectSchema = z
  .object({
    id: z.string().min(1),
    code: z.string(),
    name: z.string(),
    client: z.string(),
    status: z.enum(["open", "closed"]),
    created_at: z.string(),
    closed_at: z.string().nullable(),
    // Optional: backups from before the registry synced carry no timestamp,
    // and rows merged from the server carry a `deleted: false`.
    updated_at: z.string().optional(),
    deleted: z.boolean().optional(),
  })
  .strict();

const systemSchema = z
  .object({
    id: z.string().min(1),
    project_id: z.string().min(1),
    name: z.string(),
    code: z.string(),
    parent_system_id: z.string().nullable(),
    updated_at: z.string().optional(),
    deleted: z.boolean().optional(),
  })
  .strict();

const equipmentSchema = z
  .object({
    id: z.string().min(1),
    project_id: z.string().min(1),
    system_id: z.string().min(1),
    tag: z.string(),
    description: z.string(),
    location: z.string(),
    drawing_ref: z.string(),
    updated_at: z.string().optional(),
    deleted: z.boolean().optional(),
  })
  .strict();

export const registryBackupSchema = z
  .object({
    format: z.literal(BACKUP_FORMAT),
    version: z.literal(BACKUP_VERSION),
    exported_at: z.string(),
    projects: z.array(projectSchema),
    systems: z.array(systemSchema),
    equipment: z.array(equipmentSchema),
  })
  .strict();

export type RegistryBackup = z.infer<typeof registryBackupSchema>;

/** How many of each entity a backup carries — shown after export and import. */
export interface RegistryCounts {
  projects: number;
  systems: number;
  equipment: number;
}

export function buildBackup(input: {
  projects: Project[];
  systems: SystemNode[];
  equipment: Equipment[];
  now: string;
}): RegistryBackup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exported_at: input.now,
    projects: input.projects,
    systems: input.systems,
    equipment: input.equipment,
  };
}

/**
 * Read a backup file's text. Throws with a message aimed at whoever is standing
 * in front of the file picker (CLAUDE.md screen UI: say what to do about it).
 */
export function parseBackup(text: string): RegistryBackup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      "That file isn't readable. Choose the .json file exported by “Export registry”.",
    );
  }
  const parsed = registryBackupSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      "That isn't a registry backup from this app. Choose the .json file exported by “Export registry”.",
    );
  }
  return parsed.data;
}

export function countsOf(backup: RegistryBackup): RegistryCounts {
  return {
    projects: backup.projects.length,
    systems: backup.systems.length,
    equipment: backup.equipment.length,
  };
}

/** `itp-itr-registry-2026-08-10.json` — dated so successive backups don't collide. */
export function backupFilename(exportedAt: string): string {
  const day = exportedAt.slice(0, 10);
  return `${BACKUP_FORMAT}-${day}.json`;
}

/** "2 projects, 5 systems, 34 equipment tags" — for the on-screen confirmation. */
export function describeCounts(counts: RegistryCounts): string {
  const plural = (n: number, one: string, many = `${one}s`) =>
    `${n} ${n === 1 ? one : many}`;
  return [
    plural(counts.projects, "project"),
    plural(counts.systems, "system"),
    plural(counts.equipment, "equipment tag"),
  ].join(", ");
}
