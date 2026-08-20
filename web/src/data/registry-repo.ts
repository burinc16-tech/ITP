import {
  buildBackup,
  countsOf,
  type RegistryBackup,
  type RegistryCounts,
} from "../lib/registry-backup";
import type { ChecklistDb } from "./db";
import type { Equipment, Project, SystemNode } from "./registry";
import type { SyncLayer } from "./sync";

/** Epoch stand-in for rows written before the registry carried `updated_at`. */
const NEVER = "";

/**
 * Local persistence for the project registry (SPEC §4, §10 screen 8). Reference
 * data managed by a Project Admin (§9), so writes are upserts keyed by client id
 * — editable, unlike the append-only signature and audit stores.
 *
 * Like the calibration register, writes go to Dexie first and are pushed
 * afterwards (Hard Rule #1) — the push is best-effort, so the registry keeps
 * working with no network and the row is durable either way. `syncDown` merges
 * the server's copy in, which is what makes a registry built on one device
 * visible on the next, and restores it after a cleared browser.
 */
export class RegistryRepo {
  constructor(
    private readonly db: ChecklistDb,
    private readonly sync?: SyncLayer,
  ) {}

  async addProject(project: Project): Promise<void> {
    const row = { ...project, updated_at: project.updated_at ?? new Date().toISOString() };
    await this.db.projects.put(row);
    await this.sync?.pushProject(row);
  }

  async listProjects(): Promise<Project[]> {
    return (await this.db.projects.toArray()).filter((p) => !p.deleted);
  }

  async getProject(id: string): Promise<Project | undefined> {
    const row = await this.db.projects.get(id);
    return row?.deleted ? undefined : row;
  }

  async addSystem(system: SystemNode): Promise<void> {
    const row = { ...system, updated_at: system.updated_at ?? new Date().toISOString() };
    await this.db.systems.put(row);
    await this.sync?.pushSystem(row);
  }

  async getSystem(id: string): Promise<SystemNode | undefined> {
    const row = await this.db.systems.get(id);
    return row?.deleted ? undefined : row;
  }

  async getEquipment(id: string): Promise<Equipment | undefined> {
    const row = await this.db.equipment.get(id);
    return row?.deleted ? undefined : row;
  }

  /** All systems for a project, including subsystems (nesting via parent id). */
  async listSystems(projectId: string): Promise<SystemNode[]> {
    return this.db.systems
      .where("project_id")
      .equals(projectId)
      .and((s) => !s.deleted)
      .toArray();
  }

  async addEquipment(equipment: Equipment): Promise<void> {
    const row = { ...equipment, updated_at: equipment.updated_at ?? new Date().toISOString() };
    await this.db.equipment.put(row);
    await this.sync?.pushEquipment(row);
  }

  async listEquipment(projectId: string): Promise<Equipment[]> {
    return this.db.equipment
      .where("project_id")
      .equals(projectId)
      .and((e) => !e.deleted)
      .toArray();
  }

  /** Every system across all projects, for resolving ids in cross-project views. */
  async listAllSystems(): Promise<SystemNode[]> {
    return (await this.db.systems.toArray()).filter((s) => !s.deleted);
  }

  /** Every equipment tag across all projects, for cross-project views. */
  async listAllEquipment(): Promise<Equipment[]> {
    return (await this.db.equipment.toArray()).filter((e) => !e.deleted);
  }

  /**
   * Remove a registry entry. Kept as a tombstone rather than deleted outright
   * (like calibration-register removals): the removal has to reach the server
   * and the other devices, and a row erased locally has nothing left to push.
   * These are dumb setters — the "nothing still references it" guards live in
   * `registry-delete.ts`, the single delete path the UI calls.
   */
  async removeProject(id: string): Promise<void> {
    const existing = await this.db.projects.get(id);
    if (!existing || existing.deleted) return;
    const tombstone = { ...existing, deleted: true, updated_at: new Date().toISOString() };
    await this.db.projects.put(tombstone);
    await this.sync?.pushProject(tombstone);
  }

  async removeSystem(id: string): Promise<void> {
    const existing = await this.db.systems.get(id);
    if (!existing || existing.deleted) return;
    const tombstone = { ...existing, deleted: true, updated_at: new Date().toISOString() };
    await this.db.systems.put(tombstone);
    await this.sync?.pushSystem(tombstone);
  }

  async removeEquipment(id: string): Promise<void> {
    const existing = await this.db.equipment.get(id);
    if (!existing || existing.deleted) return;
    const tombstone = { ...existing, deleted: true, updated_at: new Date().toISOString() };
    await this.db.equipment.put(tombstone);
    await this.sync?.pushEquipment(tombstone);
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
    // A restored backup should reach the other devices too — push it up
    // best-effort; syncDown re-pushes anything that doesn't land now.
    for (const p of backup.projects) await this.sync?.pushProject(p);
    for (const s of backup.systems) await this.sync?.pushSystem(s);
    for (const e of backup.equipment) await this.sync?.pushEquipment(e);
    return countsOf(backup);
  }

  /**
   * Merge the server's registry into the local one, newest edit winning per row,
   * then push back anything the server has not seen — same self-heal as the
   * calibration register. Best-effort: with no sync layer or no network it is a
   * no-op and the local registry is unchanged.
   */
  async syncDown(): Promise<void> {
    if (!this.sync) return;
    const remote = await this.sync.pullRegistry();
    if (!remote) return;

    await this.mergeTable(this.db.projects, remote.projects, (row) => this.sync!.pushProject(row));
    await this.mergeTable(this.db.systems, remote.systems, (row) => this.sync!.pushSystem(row));
    await this.mergeTable(this.db.equipment, remote.equipment, (row) =>
      this.sync!.pushEquipment(row),
    );
  }

  private async mergeTable<T extends { id: string; updated_at?: string }>(
    table: { toArray(): Promise<T[]>; put(row: T): Promise<unknown> },
    remote: T[],
    push: (row: T) => Promise<void>,
  ): Promise<void> {
    const local = new Map((await table.toArray()).map((r) => [r.id, r]));

    for (const row of remote) {
      const mine = local.get(row.id);
      if (!mine || (mine.updated_at ?? NEVER) < (row.updated_at ?? NEVER)) {
        await table.put(row);
        local.set(row.id, row);
      }
    }

    // Anything local the server does not have, or has an older copy of, was
    // written offline (or before the registry synced at all) — push it up.
    const remoteById = new Map(remote.map((r) => [r.id, r]));
    for (const mine of local.values()) {
      const theirs = remoteById.get(mine.id);
      if (!theirs || (theirs.updated_at ?? NEVER) < (mine.updated_at ?? NEVER)) {
        await push(mine);
      }
    }
  }
}
