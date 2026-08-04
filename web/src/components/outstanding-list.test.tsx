import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseTemplate } from "@schema";
import heatLoadRaw from "../../../spec/templates/heat-load-test.json";
import { ChecklistDb } from "../data/db";
import { createDraft, type ChecklistRecord } from "../data/record";
import { RecordsRepo } from "../data/records-repo";
import { createEquipment, createProject } from "../data/registry";
import { RegistryRepo } from "../data/registry-repo";
import { uuidv7 } from "../data/uuidv7";
import { OutstandingList } from "./outstanding-list";

const heatLoad = parseTemplate(heatLoadRaw);

function failingRecord(projectId: string, equipmentId: string): ChecklistRecord {
  const rec = createDraft(heatLoad, {
    id: uuidv7(),
    now: "2026-08-04T00:00:00.000Z",
    createdBy: "u",
    projectId,
    equipmentId,
  });
  rec.values.rows.s2_01 = { value: "fail", remarks: "load bank short" };
  return { ...rec, status: "completed" };
}

async function harness() {
  const db = new ChecklistDb(`test-${uuidv7()}`);
  const repo = new RecordsRepo(db);
  const registryRepo = new RegistryRepo(db);
  await registryRepo.addProject(createProject({ id: "p1", now: "t", code: "AMK3", name: "AMK Three", client: "C" }));
  await registryRepo.addProject(createProject({ id: "p2", now: "t", code: "OTHER", name: "Other Job", client: "C" }));
  await registryRepo.addEquipment(createEquipment({ id: "e1", projectId: "p1", systemId: "s1", tag: "DB-1" }));
  await registryRepo.addEquipment(createEquipment({ id: "e2", projectId: "p2", systemId: "s2", tag: "FCU-2" }));
  const r1 = failingRecord("p1", "e1");
  const r2 = failingRecord("p2", "e2");
  await repo.upsert(r1);
  await repo.upsert(r2);
  return { repo, registryRepo, r1, r2 };
}

describe("OutstandingList", () => {
  it("groups failing rows per project and shows the equipment tag", async () => {
    const { repo, registryRepo } = await harness();
    render(
      <OutstandingList repo={repo} registryRepo={registryRepo} templates={[heatLoad]} onOpen={vi.fn()} />,
    );

    expect(await screen.findByText("Outstanding items (2)")).toBeInTheDocument();
    expect(screen.getByText("AMK3 — AMK Three (1)")).toBeInTheDocument();
    expect(screen.getByText("OTHER — Other Job (1)")).toBeInTheDocument();
    expect(screen.getByText("DB-1")).toBeInTheDocument();
    expect(screen.getByText("FCU-2")).toBeInTheDocument();
    expect(screen.getAllByText("load bank short")).toHaveLength(2); // remark carried
  });

  it("filters to a single project", async () => {
    const { repo, registryRepo } = await harness();
    render(
      <OutstandingList repo={repo} registryRepo={registryRepo} templates={[heatLoad]} onOpen={vi.fn()} />,
    );
    await screen.findByText("Outstanding items (2)");

    await userEvent.selectOptions(screen.getByLabelText("Project"), "p1");

    expect(screen.getByText("Outstanding items (1)")).toBeInTheDocument();
    expect(screen.getByText("AMK3 — AMK Three (1)")).toBeInTheDocument();
    // The other project's group and its equipment tag are gone (the dropdown
    // still lists OTHER as an option, so assert on the group, not the substring).
    expect(screen.queryByText("OTHER — Other Job (1)")).toBeNull();
    expect(screen.queryByText("FCU-2")).toBeNull();
  });

  it("opens the source record", async () => {
    const { repo, registryRepo, r1 } = await harness();
    const onOpen = vi.fn();
    render(
      <OutstandingList repo={repo} registryRepo={registryRepo} templates={[heatLoad]} onOpen={onOpen} />,
    );
    await screen.findByText("Outstanding items (2)");

    const amkGroup = screen.getByText("AMK3 — AMK Three (1)").closest("section")!;
    await userEvent.click(within(amkGroup).getByRole("button", { name: "Open" }));

    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpen.mock.calls[0]![0].id).toBe(r1.id);
  });

  it("shows an empty state when nothing is failing", async () => {
    const db = new ChecklistDb(`test-${uuidv7()}`);
    render(
      <OutstandingList
        repo={new RecordsRepo(db)}
        registryRepo={new RegistryRepo(db)}
        templates={[heatLoad]}
        onOpen={vi.fn()}
      />,
    );
    expect(await screen.findByText("No outstanding items.")).toBeInTheDocument();
  });
});
