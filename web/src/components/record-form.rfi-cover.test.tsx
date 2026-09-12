import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseTemplate } from "@schema";
import rawTemplate from "../../../spec/templates/heat-load-test.json";
import { AuditRepo } from "../data/audit-repo";
import { ChecklistDb } from "../data/db";
import { createDraft, type ChecklistRecord } from "../data/record";
import { RecordsRepo } from "../data/records-repo";
import { RegistryRepo } from "../data/registry-repo";
import { SignaturesRepo } from "../data/signatures-repo";
import { PassthroughSync } from "../data/sync";
import { uuidv7 } from "../data/uuidv7";
import { coverStateOf } from "../lib/rfi-cover";
import { RecordForm } from "./record-form";

const template = parseTemplate(rawTemplate);

const COVER_TOGGLE = "Include Inspection Request cover page";

function setup(record?: Partial<ChecklistRecord>) {
  const db = new ChecklistDb(`test-${uuidv7()}`);
  const repo = new RecordsRepo(db);
  const id = uuidv7();
  const draft = {
    ...createDraft(template, { id, now: "2026-09-12T00:00:00.000Z", createdBy: "u" }),
    ...record,
  };
  const open = () =>
    render(
      <RecordForm
        template={template}
        recordId={id}
        repo={repo}
        signaturesRepo={new SignaturesRepo(db)}
        auditRepo={new AuditRepo(db)}
        registryRepo={new RegistryRepo(db)}
        role="site_engineer"
        sync={new PassthroughSync()}
        autosaveMs={5000}
      />,
    );
  return { id, repo, draft, open };
}

describe("RecordForm — Inspection Request cover persists on the record (SPEC §12)", () => {
  it("keeps the cover ticked, with its chosen result, after Save record and reopen", async () => {
    const user = userEvent.setup();
    const { id, repo, draft, open } = setup();
    await repo.upsert(draft);
    const first = open();

    const toggle = await screen.findByLabelText(COVER_TOGGLE);
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    expect(toggle).toBeChecked();

    // The result radios appear with the cover and default to blank.
    expect(screen.getByLabelText("Leave blank")).toBeChecked();
    await user.click(screen.getByLabelText("Conditional Pass"));
    expect(screen.getByLabelText("Conditional Pass")).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Save record" }));
    await waitFor(async () => {
      const stored = await repo.get(id);
      expect(coverStateOf(stored!.values)).toMatchObject({
        enabled: true,
        options: { result: "conditional", discipline: "acmv" },
      });
    });

    // Reopen: the toggle and the result are exactly as saved.
    first.unmount();
    open();
    expect(await screen.findByLabelText(COVER_TOGGLE)).toBeChecked();
    expect(screen.getByLabelText("Conditional Pass")).toBeChecked();
    expect(screen.getByLabelText("Leave blank")).not.toBeChecked();
  });

  it("keeps edited cover text across reopen, and un-ticking persists too", async () => {
    const user = userEvent.setup();
    const { id, repo, draft, open } = setup();
    await repo.upsert(draft);
    const first = open();

    await user.click(await screen.findByLabelText(COVER_TOGGLE));
    const floor = screen.getByLabelText("Floor");
    await user.clear(floor);
    await user.type(floor, "Level 7");
    await user.click(screen.getByRole("button", { name: "Save record" }));
    await waitFor(async () => {
      const stored = await repo.get(id);
      expect(coverStateOf(stored!.values).options?.floor).toBe("Level 7");
    });
    first.unmount();

    const second = open();
    expect(await screen.findByLabelText(COVER_TOGGLE)).toBeChecked();
    expect(screen.getByLabelText("Floor")).toHaveValue("Level 7");

    // Un-tick and save: reopen shows it off, but the edits are kept for next time.
    await user.click(screen.getByLabelText(COVER_TOGGLE));
    await user.click(screen.getByRole("button", { name: "Save record" }));
    await waitFor(async () => {
      const stored = await repo.get(id);
      expect(coverStateOf(stored!.values).enabled).toBe(false);
    });
    second.unmount();

    open();
    expect(await screen.findByLabelText(COVER_TOGGLE)).not.toBeChecked();
    const stored = await repo.get(id);
    expect(coverStateOf(stored!.values).options?.floor).toBe("Level 7");
  });

  it("opens a record written before the cover persisted with the cover off", async () => {
    const { repo, draft, open } = setup();
    await repo.upsert(draft);
    open();
    expect(await screen.findByLabelText(COVER_TOGGLE)).not.toBeChecked();
    expect(screen.queryByText("Inspection Request cover — details")).toBeNull();
  });

  it("still lets a locked record print with a cover without writing its values", async () => {
    const user = userEvent.setup();
    const { id, repo, draft, open } = setup({ status: "accepted", serial_no: "HLT-01" });
    await repo.upsert(draft);
    open();

    const toggle = await screen.findByLabelText(COVER_TOGGLE);
    await user.click(toggle);
    expect(toggle).toBeChecked();
    await user.click(screen.getByLabelText("Pass"));
    expect(screen.getByText("☑ PASS")).toBeInTheDocument();

    // Nothing was written: an accepted record's values are evidence (Hard Rule #6).
    const stored = await repo.get(id);
    expect(stored!.values.rfi_cover).toBeUndefined();
    expect(stored!.updated_at).toBe(draft.updated_at);
  });
});
