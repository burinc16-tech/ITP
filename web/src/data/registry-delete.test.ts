import { describe, it, expect } from "vitest";
import { parseTemplate } from "@schema";
import rawTemplate from "../../../spec/templates/heat-load-test.json";
import { ChecklistDb } from "./db";
import { createDraft, type ChecklistRecord } from "./record";
import { RecordsRepo } from "./records-repo";
import { deleteEquipment, deleteProject, deleteSystem } from "./registry-delete";
import { RegistryRepo } from "./registry-repo";
import { createEquipment, createProject, createSystem } from "./registry";
import type { Equipment, Project, SystemNode } from "./registry";
import { PassthroughSync } from "./sync";
import { uuidv7 } from "./uuidv7";

const template = parseTemplate(rawTemplate);

/** A sync layer that records registry pushes, to assert tombstones go up. */
class RecordingSync extends PassthroughSync {
  readonly projects: Project[] = [];
  readonly systems: SystemNode[] = [];
  readonly equipment: Equipment[] = [];
  override async pushProject(p: Project): Promise<void> {
    this.projects.push(p);
  }
  override async pushSystem(s: SystemNode): Promise<void> {
    this.systems.push(s);
  }
  override async pushEquipment(e: Equipment): Promise<void> {
    this.equipment.push(e);
  }
}

async function harness() {
  const db = new ChecklistDb(`test-${uuidv7()}`);
  const sync = new RecordingSync();
  const registry = new RegistryRepo(db, sync);
  const records = new RecordsRepo(db);

  const projectId = uuidv7();
  const systemId = uuidv7();
  const equipmentId = uuidv7();
  await registry.addProject(
    createProject({ id: projectId, now: "t", code: "AMK3", name: "AMK", client: "C" }),
  );
  await registry.addSystem(
    createSystem({ id: systemId, projectId, name: "ACMV", code: "A" }),
  );
  await registry.addEquipment(
    createEquipment({ id: equipmentId, projectId, systemId, tag: "FCU-01" }),
  );
  sync.projects.length = 0; // count only the deletes from here on
  sync.systems.length = 0;
  sync.equipment.length = 0;

  const deps = { registry, records };
  const record = (over: Partial<ChecklistRecord>): ChecklistRecord => ({
    ...createDraft(template, { id: uuidv7(), now: "t", createdBy: "eng" }),
    project_id: projectId,
    ...over,
  });
  return { deps, registry, records, sync, projectId, systemId, equipmentId, record };
}

/**
 * Registry deletes are bottom-up and never orphan anything: an entry still on
 * live records, or still containing children, is refused with a message that
 * says what to remove first. The delete itself is a synced tombstone.
 */
describe("registry delete", () => {
  it("refuses to delete a tag that live records reference", async () => {
    const { deps, records, registry, equipmentId, systemId, record } = await harness();
    await records.upsert(record({ system_id: systemId, equipment_id: equipmentId }));

    await expect(deleteEquipment(deps, equipmentId)).rejects.toThrow(/1 record/);
    expect(await registry.getEquipment(equipmentId)).toBeDefined(); // untouched
  });

  it("a deleted (tombstoned) record no longer blocks its tag", async () => {
    const { deps, records, registry, sync, equipmentId, systemId, record } = await harness();
    const r = record({ system_id: systemId, equipment_id: equipmentId });
    await records.upsert({ ...r, deleted: true });

    await deleteEquipment(deps, equipmentId);
    expect(await registry.getEquipment(equipmentId)).toBeUndefined();
    // The tombstone went up so the delete reaches the other devices.
    expect(sync.equipment).toHaveLength(1);
    expect(sync.equipment[0]).toMatchObject({ id: equipmentId, deleted: true });
  });

  it("refuses to delete a system that still has tags, then allows it bottom-up", async () => {
    const { deps, registry, systemId, equipmentId } = await harness();
    await expect(deleteSystem(deps, systemId)).rejects.toThrow(/1 equipment tag/);

    await deleteEquipment(deps, equipmentId);
    await deleteSystem(deps, systemId);
    expect(await registry.getSystem(systemId)).toBeUndefined();
  });

  it("refuses to delete a system with a subsystem", async () => {
    const { deps, registry, projectId, systemId, equipmentId } = await harness();
    await registry.addSystem(
      createSystem({ id: uuidv7(), projectId, name: "Sub", code: "S1", parentSystemId: systemId }),
    );
    await deleteEquipment(deps, equipmentId);
    await expect(deleteSystem(deps, systemId)).rejects.toThrow(/1 subsystem/);
  });

  it("refuses to delete a project until everything under it is gone", async () => {
    const { deps, registry, sync, projectId, systemId, equipmentId } = await harness();
    await expect(deleteProject(deps, projectId)).rejects.toThrow(/1 system/);

    await deleteEquipment(deps, equipmentId);
    await deleteSystem(deps, systemId);
    await deleteProject(deps, projectId);
    expect(await registry.listProjects()).toHaveLength(0);
    expect(sync.projects[0]).toMatchObject({ id: projectId, deleted: true });
  });

  it("refuses to delete a project that live records reference directly", async () => {
    const { deps, records, projectId, systemId, equipmentId, record } = await harness();
    // A record on the project but with no equipment link — still a reference.
    await records.upsert(record({ system_id: null, equipment_id: null }));
    await deleteEquipment(deps, equipmentId);
    await deleteSystem(deps, systemId);
    await expect(deleteProject(deps, projectId)).rejects.toThrow(/1 record/);
  });

  it("deleting an already-deleted system is a no-op", async () => {
    const { deps, sync, systemId, equipmentId } = await harness();
    await deleteEquipment(deps, equipmentId);
    await deleteSystem(deps, systemId);
    await deleteSystem(deps, systemId); // second time
    expect(sync.systems).toHaveLength(1);
  });
});
