import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseTemplate } from "@schema";
import heatLoadRaw from "../../../spec/templates/heat-load-test.json";
import { ChecklistDb } from "../data/db";
import { createDraft } from "../data/record";
import { RecordsRepo } from "../data/records-repo";
import { RegistryRepo } from "../data/registry-repo";
import { createEquipment, createProject, createSystem } from "../data/registry";
import { uuidv7 } from "../data/uuidv7";
import { EquipmentTree } from "./equipment-tree";

const heatLoad = parseTemplate(heatLoadRaw);

describe("EquipmentTree", () => {
  it("creates a project, then adds a system and an equipment tag to its tree", async () => {
    const user = userEvent.setup();
    const db = new ChecklistDb(`test-${uuidv7()}`);
    const repo = new RegistryRepo(db);
    render(
      <EquipmentTree
        registryRepo={repo}
        recordsRepo={new RecordsRepo(db)}
        onNewITR={vi.fn()}
      />,
    );

    // Create and auto-select a project.
    await user.type(screen.getByLabelText("Project code"), "AMK3");
    await user.type(screen.getByLabelText("Project name"), "AMK Level 3");
    await user.click(screen.getByRole("button", { name: "New project" }));
    expect(await screen.findByText(/No systems yet/)).toBeInTheDocument();

    // Add a system.
    await user.type(screen.getByLabelText("System name"), "Electrical");
    await user.click(screen.getByRole("button", { name: "Add system" }));
    expect(await screen.findByText("Under: Electrical")).toBeInTheDocument(); // in parent dropdown
    expect(screen.queryByText(/No systems yet/)).toBeNull();

    // Add an equipment tag under it.
    await user.type(screen.getByLabelText("Equipment tag"), "DB-1");
    await user.selectOptions(screen.getByLabelText("Equipment system"), "Electrical");
    await user.click(screen.getByRole("button", { name: "Add equipment" }));
    expect(await screen.findByText("DB-1")).toBeInTheDocument();

    // Persisted to the store.
    const projects = await repo.listProjects();
    expect(projects).toHaveLength(1);
    const equipment = await repo.listEquipment(projects[0]!.id);
    expect(equipment.map((e) => e.tag)).toEqual(["DB-1"]);
  });

  it("shows per-tag ITR completion and starts a new ITR for the tag", async () => {
    const user = userEvent.setup();
    const db = new ChecklistDb(`test-${uuidv7()}`);
    const registryRepo = new RegistryRepo(db);
    const recordsRepo = new RecordsRepo(db);

    const pid = uuidv7();
    const sid = uuidv7();
    const eid = uuidv7();
    await registryRepo.addProject(createProject({ id: pid, now: "t", code: "AMK3", name: "AMK", client: "C" }));
    await registryRepo.addSystem(createSystem({ id: sid, projectId: pid, name: "Electrical", code: "E" }));
    await registryRepo.addEquipment(createEquipment({ id: eid, projectId: pid, systemId: sid, tag: "DB-1" }));
    await recordsRepo.upsert({
      ...createDraft(heatLoad, {
        id: uuidv7(),
        now: "t",
        createdBy: "u",
        projectId: pid,
        systemId: sid,
        equipmentId: eid,
      }),
      status: "accepted",
    });

    const onNewITR = vi.fn();
    render(
      <EquipmentTree registryRepo={registryRepo} recordsRepo={recordsRepo} onNewITR={onNewITR} />,
    );

    await user.selectOptions(await screen.findByLabelText("Project"), pid);
    expect(await screen.findByText("1 ITR · 1 accepted")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "New ITR" }));
    expect(onNewITR).toHaveBeenCalledWith(expect.objectContaining({ id: eid }));
  });
});
