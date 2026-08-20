import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

  it("restores a project from a backup file when the browser has been cleared", async () => {
    const user = userEvent.setup();

    // The device that had the project, before its storage was cleared.
    const source = new RegistryRepo(new ChecklistDb(`test-${uuidv7()}`));
    const pid = uuidv7();
    const sid = uuidv7();
    await source.addProject(
      createProject({ id: pid, now: "t", code: "AMK3", name: "AMK Level 3", client: "Apple" }),
    );
    await source.addSystem(createSystem({ id: sid, projectId: pid, name: "ACMV", code: "A" }));
    await source.addEquipment(
      createEquipment({ id: uuidv7(), projectId: pid, systemId: sid, tag: "AHU-B-102" }),
    );
    const backup = await source.exportBackup("2026-08-10T00:00:00.000Z");

    // The cleared browser: empty registry, one file to hand.
    const db = new ChecklistDb(`test-${uuidv7()}`);
    const repo = new RegistryRepo(db);
    render(
      <EquipmentTree registryRepo={repo} recordsRepo={new RecordsRepo(db)} onNewITR={vi.fn()} />,
    );
    expect(screen.queryByText(/AMK3 — AMK Level 3/)).toBeNull();

    const file = new File([JSON.stringify(backup)], "itp-itr-registry-2026-08-10.json", {
      type: "application/json",
    });
    await user.upload(screen.getByLabelText("Registry backup file"), file);

    expect(
      await screen.findByText("Restored 1 project, 1 system, 1 equipment tag."),
    ).toBeInTheDocument();
    expect(await screen.findByText("AMK3 — AMK Level 3")).toBeInTheDocument();
    expect(await repo.listProjects()).toHaveLength(1);
  });

  it("says what is wrong when the wrong file is picked, and imports nothing", async () => {
    const user = userEvent.setup();
    const db = new ChecklistDb(`test-${uuidv7()}`);
    const repo = new RegistryRepo(db);
    render(
      <EquipmentTree registryRepo={repo} recordsRepo={new RecordsRepo(db)} onNewITR={vi.fn()} />,
    );

    // A .json file that isn't a backup — the picker's `accept` filter lets it
    // through, so the app must say so rather than importing nothing silently.
    const wrong = new File(["<!doctype html>"], "report.json", {
      type: "application/json",
    });
    await user.upload(screen.getByLabelText("Registry backup file"), wrong);

    expect(await screen.findByRole("status")).toHaveTextContent(/Export registry/);
    expect(await repo.listProjects()).toHaveLength(0);
  });

  it("exports the registry to a file", async () => {
    const user = userEvent.setup();
    const db = new ChecklistDb(`test-${uuidv7()}`);
    const repo = new RegistryRepo(db);
    await repo.addProject(
      createProject({ id: uuidv7(), now: "t", code: "AMK3", name: "AMK", client: "C" }),
    );
    render(
      <EquipmentTree registryRepo={repo} recordsRepo={new RecordsRepo(db)} onNewITR={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: "Export registry" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Saved 1 project, 0 systems, 0 equipment tags to your device.",
    );
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

  /**
   * Registry deletes are bottom-up: a tag with live records, or a system/project
   * with anything still under it, is refused with a message saying what to
   * remove first. A confirmed delete tombstones the entry (it syncs).
   */
  it("refuses to delete a tag with records, then deletes bottom-up to the project", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      const db = new ChecklistDb(`test-${uuidv7()}`);
      const registryRepo = new RegistryRepo(db);
      const recordsRepo = new RecordsRepo(db);

      const pid = uuidv7();
      const sid = uuidv7();
      const eid = uuidv7();
      await registryRepo.addProject(
        createProject({ id: pid, now: "t", code: "AMK3", name: "AMK", client: "C" }),
      );
      await registryRepo.addSystem(
        createSystem({ id: sid, projectId: pid, name: "Electrical", code: "E" }),
      );
      await registryRepo.addEquipment(
        createEquipment({ id: eid, projectId: pid, systemId: sid, tag: "DB-1" }),
      );
      const record = createDraft(heatLoad, {
        id: uuidv7(),
        now: "t",
        createdBy: "u",
        projectId: pid,
        systemId: sid,
        equipmentId: eid,
      });
      await recordsRepo.upsert(record);

      render(
        <EquipmentTree registryRepo={registryRepo} recordsRepo={recordsRepo} onNewITR={vi.fn()} />,
      );
      await user.selectOptions(await screen.findByLabelText("Project"), pid);
      await screen.findByText("DB-1");

      // The tag still has a record — refused, with what to do about it.
      const deletes = () => screen.getAllByRole("button", { name: "Delete" });
      await user.click(deletes()[1]!); // [0] is the system row, [1] the tag
      expect(await screen.findByRole("status")).toHaveTextContent(
        "This tag is on 1 record in the register. Delete those records first.",
      );
      expect(screen.getByText("DB-1")).toBeInTheDocument();

      // Remove the record (tombstone), then the whole chain deletes bottom-up.
      await recordsRepo.upsert({ ...record, deleted: true });
      await user.click(deletes()[1]!);
      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent('Deleted tag "DB-1".'),
      );
      // The note lands before the tree reload finishes — wait for the row to go.
      await waitFor(() => expect(screen.queryByText("DB-1")).toBeNull());

      await user.click(screen.getByRole("button", { name: "Delete" })); // the system
      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent('Deleted system "Electrical".'),
      );

      await user.click(screen.getByRole("button", { name: "Delete project" }));
      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent('Deleted project "AMK3 — AMK".'),
      );
      expect(await registryRepo.listProjects()).toHaveLength(0);
    } finally {
      confirm.mockRestore();
    }
  });
});
