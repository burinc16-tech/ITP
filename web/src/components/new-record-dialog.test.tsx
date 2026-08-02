import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseTemplate } from "@schema";
import heatLoadRaw from "../../../spec/templates/heat-load-test.json";
import { ChecklistDb } from "../data/db";
import { RegistryRepo } from "../data/registry-repo";
import { createEquipment, createProject, createSystem } from "../data/registry";
import { uuidv7 } from "../data/uuidv7";
import { NewRecordDialog } from "./new-record-dialog";

const heatLoad = parseTemplate(heatLoadRaw);

describe("NewRecordDialog", () => {
  it("creates a record scoped to the chosen project and equipment", async () => {
    const user = userEvent.setup();
    const registryRepo = new RegistryRepo(new ChecklistDb(`test-${uuidv7()}`));
    const pid = uuidv7();
    const sid = uuidv7();
    const eid = uuidv7();
    await registryRepo.addProject(createProject({ id: pid, now: "t", code: "AMK3", name: "AMK", client: "C" }));
    await registryRepo.addSystem(createSystem({ id: sid, projectId: pid, name: "Electrical", code: "E" }));
    await registryRepo.addEquipment(createEquipment({ id: eid, projectId: pid, systemId: sid, tag: "DB-1" }));

    const onCreate = vi.fn();
    render(
      <NewRecordDialog
        templates={[heatLoad]}
        registryRepo={registryRepo}
        onCreate={onCreate}
        onCancel={vi.fn()}
      />,
    );

    await user.selectOptions(await screen.findByLabelText("Project"), pid);
    await screen.findByRole("option", { name: "DB-1" });
    await user.selectOptions(screen.getByLabelText("Equipment (optional)"), eid);
    await user.click(screen.getByRole("button", { name: "Create record" }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: pid, equipmentId: eid }),
    );
  });

  it("prompts to create a project when none exist", async () => {
    const registryRepo = new RegistryRepo(new ChecklistDb(`test-${uuidv7()}`));
    render(
      <NewRecordDialog
        templates={[heatLoad]}
        registryRepo={registryRepo}
        onCreate={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(
      await screen.findByText(/Create one in the Equipment tab first/),
    ).toBeInTheDocument();
  });
});
