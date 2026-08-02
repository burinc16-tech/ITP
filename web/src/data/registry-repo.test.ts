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
