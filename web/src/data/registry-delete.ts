import type { RecordsRepo } from "./records-repo";
import type { RegistryRepo } from "./registry-repo";

export interface RegistryDeleteDeps {
  registry: RegistryRepo;
  records: RecordsRepo;
}

/**
 * The single delete path for registry entries (projects, systems, equipment).
 * Deletion is bottom-up and never orphans anything: an entry still referenced
 * by live records — or, for systems and projects, one that still contains live
 * children — is refused with a message that says what to remove first. The
 * write itself is a synced tombstone (see RegistryRepo.remove*), so the
 * removal reaches the server and every other device.
 *
 * Records are the reference that matters: a record row resolves its Project /
 * System / Equipment columns through these ids, so deleting a referenced entry
 * would blank those columns on a record that still exists. Deleted (tombstoned)
 * records don't count — `records.list()` already hides them.
 */

const plural = (n: number, what: string): string => `${n} ${what}${n === 1 ? "" : "s"}`;

export async function deleteEquipment(deps: RegistryDeleteDeps, id: string): Promise<void> {
  const used = (await deps.records.list()).filter((r) => r.equipment_id === id).length;
  if (used > 0) {
    throw new Error(
      `This tag is on ${plural(used, "record")} in the register. Delete those records first.`,
    );
  }
  await deps.registry.removeEquipment(id);
}

export async function deleteSystem(deps: RegistryDeleteDeps, id: string): Promise<void> {
  const system = await deps.registry.getSystem(id);
  if (!system) return; // already gone — idempotent
  const children = (await deps.registry.listSystems(system.project_id)).filter(
    (s) => s.parent_system_id === id,
  ).length;
  if (children > 0) {
    throw new Error(
      `This system has ${plural(children, "subsystem")}. Delete those first.`,
    );
  }
  const tags = (await deps.registry.listEquipment(system.project_id)).filter(
    (e) => e.system_id === id,
  ).length;
  if (tags > 0) {
    throw new Error(
      `This system has ${plural(tags, "equipment tag")}. Delete those first.`,
    );
  }
  const used = (await deps.records.list()).filter((r) => r.system_id === id).length;
  if (used > 0) {
    throw new Error(
      `This system is on ${plural(used, "record")} in the register. Delete those records first.`,
    );
  }
  await deps.registry.removeSystem(id);
}

export async function deleteProject(deps: RegistryDeleteDeps, id: string): Promise<void> {
  const systems = (await deps.registry.listSystems(id)).length;
  if (systems > 0) {
    throw new Error(`This project has ${plural(systems, "system")}. Delete those first.`);
  }
  const tags = (await deps.registry.listEquipment(id)).length;
  if (tags > 0) {
    throw new Error(`This project has ${plural(tags, "equipment tag")}. Delete those first.`);
  }
  const used = (await deps.records.list()).filter((r) => r.project_id === id).length;
  if (used > 0) {
    throw new Error(
      `This project is on ${plural(used, "record")} in the register. Delete those records first.`,
    );
  }
  await deps.registry.removeProject(id);
}
