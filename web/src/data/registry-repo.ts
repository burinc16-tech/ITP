import {
  buildBackup,
  countsOf,
  type RegistryBackup,
  type RegistryCounts,
} from "../lib/registry-backup";
import type { ChecklistDb } from "./db";
import type { Equipment, Project, SystemNode } from "./registry";

/**
 * Local persistence for the project registry (SPEC §4, §10 screen 8). Reference
 * data managed by a Project Admin (§9), so writes are upserts keyed by client id
 * — editable, unlike the append-only signature and audit stores.
 */
export class RegistryRepo {
  constructor(private readonly db: ChecklistDb) {}

  async addProject(project: Project): Promise<void> {
    await this.db.projects.put(project);
  }

  async listProjects(): Promise<Project[]> {
    return this.db.projects.toArray();
  }

  async getProject(id: string): Promise<Project | undefined> {
    return this.db.projects.get(id);
  }

  async addSystem(system: SystemNode): Promise<void> {
    await this.db.systems.put(system);
  }

  async getSystem(id: string): Promise<SystemNode | undefined> {
    return this.db.systems.get(id);
  }

  async getEquipment(id: string): Promise<Equipment | undefined> {
    return this.db.equipment.get(id);
  }

  /** All systems for a project, including subsystems (nesting via parent id). */
  async listSystems(projectId: string): Promise<SystemNode[]> {
    return this.db.systems.where("project_id").equals(projectId).toArray();
  }

  async addEquipment(equipment: Equipment): Promise<void> {
    await this.db.equipment.put(equipment);
  }

  async listEquipment(projectId: string): Promise<Equipment[]> {
    return this.db.equipment.where("project_id").equals(projectId).toArray();
  }

  /** Every system across all projects, for resolving ids in cross-project views. */
  async listAllSystems(): Promise<SystemNode[]> {
    return this.db.systems.toArray();
  }

  /** Every equipment tag across all projects, for cross-project views. */
  async listAllEquipment(): Promise<Equipment[]> {
    return this.db.equipment.toArray();
  }

  /** The whole registry as a backup file's contents (SPEC §4). */
  async exportBackup(now: string): Promise<RegistryBackup> {
    const [projects, systems, equipment] = await Promise.all([
      this.listProjects(),
      this.listAllSystems(),
      this.listAllEquipment(),
    ]);
    return buildBackup({ projects, systems, equipment, now });
  }

  /**
   * Merge a backup into this device's registry — upsert by id, like every other
   * registry write. Merging rather than replacing is what makes one file serve
   * both jobs: restoring a cleared browser, and carrying a project to a second
   * device without wiping what that device already has. Ids are UUIDv7 from the
   * machine that created them (Hard Rule #2), so entries only ever overwrite
   * themselves.
   */
  async importBackup(backup: RegistryBackup): Promise<RegistryCounts> {
    await this.db.projects.bulkPut(backup.projects);
    await this.db.systems.bulkPut(backup.systems);
    await this.db.equipment.bulkPut(backup.equipment);
    return countsOf(backup);
  }
}
