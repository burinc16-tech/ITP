import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseTemplate } from "@schema";
import heatLoadRaw from "../../../spec/templates/heat-load-test.json";
import { createAuditEntry } from "../data/audit";
import { AuditRepo } from "../data/audit-repo";
import { ChecklistDb } from "../data/db";
import { createDraft, type ChecklistRecord } from "../data/record";
import { RecordsRepo } from "../data/records-repo";
import { RegistryRepo } from "../data/registry-repo";
import { createProject, createSystem } from "../data/registry";
import { uuidv7 } from "../data/uuidv7";
import { Dashboard } from "./dashboard";

const heatLoad = parseTemplate(heatLoadRaw);

describe("Dashboard", () => {
  it("summarises completion, lists outstanding items, and opens a record", async () => {
    const user = userEvent.setup();
    const db = new ChecklistDb(`test-${uuidv7()}`);
    const repo = new RecordsRepo(db);
    const auditRepo = new AuditRepo(db);
    const registryRepo = new RegistryRepo(db);

    const accepted = {
      ...createDraft(heatLoad, { id: uuidv7(), now: "2026-08-02T00:00:00.000Z", createdBy: "u" }),
      status: "accepted" as const,
    };
    const completedWithFail: ChecklistRecord = {
      ...createDraft(heatLoad, { id: uuidv7(), now: "2026-08-02T00:00:00.000Z", createdBy: "u" }),
      status: "completed" as const,
    };
    completedWithFail.values.rows.s2_01 = { value: "fail", remarks: "load bank fault" };
    await repo.upsert(accepted);
    await repo.upsert(completedWithFail);
    await auditRepo.add(
      createAuditEntry({
        id: uuidv7(),
        recordId: accepted.id,
        user: "u",
        role: "qa_qc",
        action: "accept",
        before: "witnessed",
        after: "accepted",
        now: "2026-08-02T04:00:00.000Z",
      }),
    );

    const onOpen = vi.fn();
    render(
      <Dashboard
        repo={repo}
        auditRepo={auditRepo}
        registryRepo={registryRepo}
        templates={[heatLoad]}
        onOpen={onOpen}
      />,
    );

    // Completion: 1 of 2 accepted = 50%.
    expect(await screen.findByText("50%")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 accepted")).toBeInTheDocument();

    // Outstanding: the failing row is listed.
    expect(screen.getByText(/Outstanding items \(1\)/)).toBeInTheDocument();
    expect(screen.getByText("load bank fault")).toBeInTheDocument();

    // Recent activity shows the accept.
    expect(screen.getByText("Accept")).toBeInTheDocument();

    // Opening the outstanding item calls back with its record.
    const outstanding = screen.getByText("load bank fault").closest("li")!;
    await user.click(within(outstanding).getByRole("button", { name: "Open" }));
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ id: completedWithFail.id }),
    );
  });

  it("groups completion by system", async () => {
    const db = new ChecklistDb(`test-${uuidv7()}`);
    const repo = new RecordsRepo(db);
    const auditRepo = new AuditRepo(db);
    const registryRepo = new RegistryRepo(db);
    const pid = uuidv7();
    const sid = uuidv7();
    await registryRepo.addProject(createProject({ id: pid, now: "t", code: "AMK3", name: "AMK", client: "C" }));
    await registryRepo.addSystem(createSystem({ id: sid, projectId: pid, name: "Electrical", code: "E" }));
    await repo.upsert({
      ...createDraft(heatLoad, {
        id: uuidv7(),
        now: "t",
        createdBy: "u",
        projectId: pid,
        systemId: sid,
      }),
      status: "accepted" as const,
    });

    render(
      <Dashboard
        repo={repo}
        auditRepo={auditRepo}
        registryRepo={registryRepo}
        templates={[heatLoad]}
        onOpen={vi.fn()}
      />,
    );

    expect(await screen.findByText("By system")).toBeInTheDocument();
    expect(screen.getByText("Electrical")).toBeInTheDocument();
    expect(screen.getAllByText("1/1 accepted").length).toBeGreaterThanOrEqual(1);
  });
});
