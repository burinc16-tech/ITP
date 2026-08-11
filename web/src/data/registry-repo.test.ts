import { describe, it, expect } from "vitest";
import { ChecklistDb } from "./db";
import { RegistryRepo } from "./registry-repo";
import { createEquipment, createProject, createSystem } from "./registry";
import { uuidv7 } from "./uuidv7";

function freshRepo(): RegistryRepo {
  return new RegistryRepo(new ChecklistDb(`test-${uuidv7()}`));
}

describe("registry factories", () => {
  it("creates an open project and null-parent system with sensible defaults", () => {
    const p = createProject({ id: "p1", now: "2026-08-02T00:00:00.000Z", code: "AMK3", name: "AMK", client: "X" });
    expect(p.status).toBe("open");
    expect(p.closed_at).toBeNull();

    const s = createSystem({ id: "s1", projectId: "p1", name: "Electrical", code: "E" });
    expect(s.parent_system_id).toBeNull();

    const e = createEquipment({ id: "e1", projectId: "p1", systemId: "s1", tag: "DB-1" });
    expect(e.description).toBe("");
    expect(e.tag).toBe("DB-1");
  });
});

describe("RegistryRepo", () => {
  it("stores and lists projects, systems, and equipment scoped to a project", async () => {
    const repo = freshRepo();
    const projectId = uuidv7();
    await repo.addProject(createProject({ id: projectId, now: "t", code: "AMK3", name: "AMK", client: "C" }));
    await repo.addProject(createProject({ id: uuidv7(), now: "t", code: "OTHER", name: "Other", client: "C" }));

    const sysId = uuidv7();
    await repo.addSystem(createSystem({ id: sysId, projectId, name: "Electrical", code: "E" }));
    await repo.addSystem(
      createSystem({ id: uuidv7(), projectId, name: "Sub DB", code: "E1", parentSystemId: sysId }),
    );
    await repo.addEquipment(createEquipment({ id: uuidv7(), projectId, systemId: sysId, tag: "DB-1" }));

    expect(await repo.listProjects()).toHaveLength(2);

    const systems = await repo.listSystems(projectId);
    expect(systems).toHaveLength(2);
    const sub = systems.find((s) => s.code === "E1");
    expect(sub?.parent_system_id).toBe(sysId); // nesting preserved

    const equipment = await repo.listEquipment(projectId);
    expect(equipment).toHaveLength(1);
    expect(equipment[0]!.tag).toBe("DB-1");
  });

  it("exports the whole registry and restores it into an empty device", async () => {
    const source = freshRepo();
    const projectId = uuidv7();
    const sysId = uuidv7();
    await source.addProject(
      createProject({ id: projectId, now: "t", code: "AMK3", name: "AMK", client: "C" }),
    );
    await source.addSystem(createSystem({ id: sysId, projectId, name: "ACMV", code: "A" }));
    await source.addEquipment(
      createEquipment({ id: uuidv7(), projectId, systemId: sysId, tag: "AHU-B-102" }),
    );

    const backup = await source.exportBackup("2026-08-10T00:00:00.000Z");
    expect(backup.projects).toHaveLength(1);

    // A cleared browser: nothing local, everything comes back from the file.
    const restored = freshRepo();
    expect(await restored.listProjects()).toHaveLength(0);
    const counts = await restored.importBackup(backup);
    expect(counts).toEqual({ projects: 1, systems: 1, equipment: 1 });
    expect((await restored.listProjects())[0]!.name).toBe("AMK");
    expect((await restored.listEquipment(projectId))[0]!.tag).toBe("AHU-B-102");
  });

  it("merges an import into an existing device rather than wiping it", async () => {
    const device = freshRepo();
    const mine = uuidv7();
    await device.addProject(
      createProject({ id: mine, now: "t", code: "MINE", name: "Mine", client: "C" }),
    );

    const other = freshRepo();
    const theirs = uuidv7();
    await other.addProject(
      createProject({ id: theirs, now: "t", code: "THEIRS", name: "Theirs", client: "C" }),
    );

    await device.importBackup(await other.exportBackup("t"));
    const codes = (await device.listProjects()).map((p) => p.code).sort();
    expect(codes).toEqual(["MINE", "THEIRS"]);
  });

  it("upserts a project by id rather than duplicating", async () => {
    const repo = freshRepo();
    const id = uuidv7();
    await repo.addProject(createProject({ id, now: "t", code: "AMK3", name: "AMK", client: "C" }));
    await repo.addProject({
      ...createProject({ id, now: "t", code: "AMK3", name: "AMK Renamed", client: "C" }),
    });
    const projects = await repo.listProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0]!.name).toBe("AMK Renamed");
  });
});
