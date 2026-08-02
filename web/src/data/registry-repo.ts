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
}
