import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseTemplate, type Template } from "@schema";
import heatLoadRaw from "../../../spec/templates/heat-load-test.json";
import powerTurnOnRaw from "../../../spec/templates/power-turn-on.json";
import { ChecklistDb } from "../data/db";
import { createDraft, type ChecklistRecord } from "../data/record";
import { RecordsRepo } from "../data/records-repo";
import { RegistryRepo } from "../data/registry-repo";
import { createEquipment, createProject, createSystem } from "../data/registry";
import { uuidv7 } from "../data/uuidv7";
import { Register } from "./register";

const emptyRegistry = new RegistryRepo(new ChecklistDb(`reg-${uuidv7()}`));

const heatLoad = parseTemplate(heatLoadRaw);
const powerTurnOn = parseTemplate(powerTurnOnRaw);
const templates = [heatLoad, powerTurnOn];

function draft(template: Template, over: Partial<ChecklistRecord> = {}): ChecklistRecord {
  return {
    ...createDraft(template, {
      id: uuidv7(),
      now: "2026-08-02T00:00:00.000Z",
      createdBy: "eng",
    }),
    ...over,
  };
}

async function seed(records: ChecklistRecord[]): Promise<RecordsRepo> {
  const repo = new RecordsRepo(new ChecklistDb(`test-${uuidv7()}`));
  for (const r of records) await repo.upsert(r);
  return repo;
}

describe("Register", () => {
  it("lists records with their template and status", async () => {
    const repo = await seed([
      draft(heatLoad, { updated_at: "2026-08-02T03:00:00.000Z" }),
      draft(powerTurnOn, { status: "completed", updated_at: "2026-08-02T04:00:00.000Z" }),
    ]);
    render(<Register repo={repo} registryRepo={emptyRegistry} templates={templates} onOpen={vi.fn()} onNewRecord={vi.fn()} onExport={vi.fn()} />);

    const table = await screen.findByRole("table");
    expect(within(table).getByText(heatLoad.title)).toBeInTheDocument();
    expect(within(table).getByText(powerTurnOn.title)).toBeInTheDocument();
    expect(within(table).getByText("Draft")).toBeInTheDocument();
    expect(within(table).getByText("Completed")).toBeInTheDocument();
  });

  it("filters by status", async () => {
    const user = userEvent.setup();
    const repo = await seed([
      draft(heatLoad),
      draft(powerTurnOn, { status: "completed" }),
    ]);
    render(<Register repo={repo} registryRepo={emptyRegistry} templates={templates} onOpen={vi.fn()} onNewRecord={vi.fn()} onExport={vi.fn()} />);
    await screen.findByRole("table");

    await user.selectOptions(screen.getByLabelText("Status"), "completed");
    const table = screen.getByRole("table");
    expect(within(table).queryByText(heatLoad.title)).toBeNull();
    expect(within(table).getByText(powerTurnOn.title)).toBeInTheDocument();
  });

  it("filters by template", async () => {
    const user = userEvent.setup();
    const repo = await seed([draft(heatLoad), draft(powerTurnOn)]);
    render(<Register repo={repo} registryRepo={emptyRegistry} templates={templates} onOpen={vi.fn()} onNewRecord={vi.fn()} onExport={vi.fn()} />);
    await screen.findByRole("table");

    await user.selectOptions(screen.getByLabelText("Template"), heatLoad.title);
    const table = screen.getByRole("table");
    expect(within(table).getByText(heatLoad.title)).toBeInTheDocument();
    expect(within(table).queryByText(powerTurnOn.title)).toBeNull();
  });

  it("opens a record and triggers new-record via callbacks", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onNewRecord = vi.fn();
    const rec = draft(heatLoad);
    const repo = await seed([rec]);
    render(
      <Register
        repo={repo}
        registryRepo={emptyRegistry}
        templates={templates}
        onOpen={onOpen}
        onNewRecord={onNewRecord}
        onExport={vi.fn()}
      />,
    );
    await screen.findByRole("table");

    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: rec.id }));

    await user.click(screen.getByRole("button", { name: "New record" }));
    expect(onNewRecord).toHaveBeenCalled();
  });

  it("marks a record that a later revision supersedes", async () => {
    const rev1 = draft(heatLoad, { status: "rejected" });
    const rev2 = draft(heatLoad, {
      rev: 2,
      supersedes: rev1.id,
      updated_at: "2026-08-02T05:00:00.000Z",
    });
    const repo = await seed([rev1, rev2]);
    render(<Register repo={repo} registryRepo={emptyRegistry} templates={templates} onOpen={vi.fn()} onNewRecord={vi.fn()} onExport={vi.fn()} />);

    await screen.findByRole("table");
    expect(screen.getByText("superseded")).toBeInTheDocument();
  });

  it("shows an empty state when there are no records", async () => {
    const repo = await seed([]);
    render(<Register repo={repo} registryRepo={emptyRegistry} templates={templates} onOpen={vi.fn()} onNewRecord={vi.fn()} onExport={vi.fn()} />);
    expect(await screen.findByText(/No records yet/)).toBeInTheDocument();
  });

  it("selects records and exports the selected ids", async () => {
    const user = userEvent.setup();
    const onExport = vi.fn();
    const a = draft(heatLoad);
    const b = draft(heatLoad);
    const repo = await seed([a, b]);
    render(<Register repo={repo} registryRepo={emptyRegistry} templates={templates} onOpen={vi.fn()} onNewRecord={vi.fn()} onExport={onExport} />);
    await screen.findByRole("table");

    // Nothing selected → export disabled.
    expect(screen.getByRole("button", { name: /Export 0 selected/ })).toBeDisabled();

    await user.click(screen.getByLabelText("Select all"));
    await user.click(screen.getByRole("button", { name: "Export 2 selected" }));

    expect(onExport).toHaveBeenCalledTimes(1);
    expect(new Set(onExport.mock.calls[0]![0])).toEqual(new Set([a.id, b.id]));
  });

  it("resolves project/system/equipment columns from the registry", async () => {
    const db = new ChecklistDb(`test-${uuidv7()}`);
    const recordsRepo = new RecordsRepo(db);
    const registry = new RegistryRepo(db);
    const pid = uuidv7();
    const sid = uuidv7();
    const eid = uuidv7();
    await registry.addProject(createProject({ id: pid, now: "t", code: "AMK3", name: "AMK", client: "C" }));
    await registry.addSystem(createSystem({ id: sid, projectId: pid, name: "Electrical", code: "E" }));
    await registry.addEquipment(createEquipment({ id: eid, projectId: pid, systemId: sid, tag: "DB-1" }));
    await recordsRepo.upsert(
      draft(heatLoad, { project_id: pid, system_id: sid, equipment_id: eid }),
    );

    render(
      <Register
        repo={recordsRepo}
        registryRepo={registry}
        templates={templates}
        onOpen={vi.fn()}
        onNewRecord={vi.fn()}
        onExport={vi.fn()}
      />,
    );

    const table = await screen.findByRole("table");
    expect(within(table).getByText("AMK3")).toBeInTheDocument();
    expect(within(table).getByText("Electrical")).toBeInTheDocument();
    expect(within(table).getByText("DB-1")).toBeInTheDocument();
  });
});
