import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseTemplate } from "@schema";
import rawTemplate from "../../../spec/templates/heat-load-test.json";
import { AuditRepo } from "../data/audit-repo";
import { ChecklistDb } from "../data/db";
import { createDraft } from "../data/record";
import { RecordsRepo } from "../data/records-repo";
import { RegistryRepo } from "../data/registry-repo";
import { SignaturesRepo } from "../data/signatures-repo";
import { PassthroughSync } from "../data/sync";
import { uuidv7 } from "../data/uuidv7";
import { RecordForm } from "./record-form";

const template = parseTemplate(rawTemplate);

function harness(db: ChecklistDb) {
  return {
    repo: new RecordsRepo(db),
    signaturesRepo: new SignaturesRepo(db),
    auditRepo: new AuditRepo(db),
    registryRepo: new RegistryRepo(db),
  };
}

describe("RecordForm — open by id (register-first)", () => {
  it("loads the specific record it is given", async () => {
    const db = new ChecklistDb(`test-${uuidv7()}`);
    const { repo, signaturesRepo, auditRepo, registryRepo } = harness(db);
    const id = uuidv7();
    const rec = createDraft(template, { id, now: "2026-08-02T00:00:00.000Z", createdBy: "u" });
    rec.values.header.doc_no = "ITR-OPEN";
    await repo.upsert(rec);

    render(
      <RecordForm
        recordId={id}
        template={template}
        repo={repo}
        signaturesRepo={signaturesRepo}
        auditRepo={auditRepo}
        registryRepo={registryRepo}
        sync={new PassthroughSync()}
        role="site_engineer"
        onBack={vi.fn()}
      />,
    );

    expect(await screen.findByLabelText("Doc No")).toHaveValue("ITR-OPEN");
  });

  it("calls onBack from the register button", async () => {
    const user = userEvent.setup();
    const db = new ChecklistDb(`test-${uuidv7()}`);
    const { repo, signaturesRepo, auditRepo, registryRepo } = harness(db);
    const id = uuidv7();
    await repo.upsert(createDraft(template, { id, now: "2026-08-02T00:00:00.000Z", createdBy: "u" }));
    const onBack = vi.fn();

    render(
      <RecordForm
        recordId={id}
        template={template}
        repo={repo}
        signaturesRepo={signaturesRepo}
        auditRepo={auditRepo}
        registryRepo={registryRepo}
        sync={new PassthroughSync()}
        role="site_engineer"
        onBack={onBack}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "← Register" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("shows a not-found message for a missing record", async () => {
    const db = new ChecklistDb(`test-${uuidv7()}`);
    const { repo, signaturesRepo, auditRepo, registryRepo } = harness(db);

    render(
      <RecordForm
        recordId={uuidv7()}
        template={template}
        repo={repo}
        signaturesRepo={signaturesRepo}
        auditRepo={auditRepo}
        registryRepo={registryRepo}
        sync={new PassthroughSync()}
        role="site_engineer"
        onBack={vi.fn()}
      />,
    );

    expect(await screen.findByText("Record not found.")).toBeInTheDocument();
  });
});
