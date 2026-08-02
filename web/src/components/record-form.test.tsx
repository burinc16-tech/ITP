import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseTemplate } from "@schema";
import rawTemplate from "../../../spec/templates/heat-load-test.json";
import { AuditRepo } from "../data/audit-repo";
import { ChecklistDb } from "../data/db";
import { RecordsRepo } from "../data/records-repo";
import { RegistryRepo } from "../data/registry-repo";
import { SignaturesRepo } from "../data/signatures-repo";
import { PassthroughSync, type SyncLayer } from "../data/sync";
import { createDraft, templateVersionId } from "../data/record";
import { emptyValues } from "../lib/values";
import { uuidv7 } from "../data/uuidv7";
import { RecordForm } from "./record-form";

const template = parseTemplate(rawTemplate);

/** Fresh, isolated store per test, with all repos sharing one db. */
function freshRepos(): {
  repo: RecordsRepo;
  signaturesRepo: SignaturesRepo;
  auditRepo: AuditRepo;
  registryRepo: RegistryRepo;
} {
  const db = new ChecklistDb(`test-${uuidv7()}`);
  return {
    repo: new RecordsRepo(db),
    signaturesRepo: new SignaturesRepo(db),
    auditRepo: new AuditRepo(db),
    registryRepo: new RegistryRepo(db),
  };
}

describe("RecordForm — local-first save path", () => {
  it("fills, saves, and resumes the draft on reload", async () => {
    const user = userEvent.setup();
    const { repo, signaturesRepo, auditRepo, registryRepo } = freshRepos();
    const sync = new PassthroughSync();

    // --- Fill ---
    const first = render(
      <RecordForm
        template={template}
        repo={repo}
        signaturesRepo={signaturesRepo}
        auditRepo={auditRepo}
        registryRepo={registryRepo}
        role="site_engineer"
        sync={sync}
        autosaveMs={5000}
      />,
    );
    const docNo = await screen.findByLabelText("Doc No");
    await user.type(docNo, "ITR-042");

    // --- Save ---
    await user.click(screen.getByRole("button", { name: "Save record" }));
    expect(await screen.findByText(/All changes saved/)).toBeInTheDocument();

    // It reached Dexie through the save path.
    const stored = await repo.latestDraft(templateVersionId(template));
    expect(stored?.values.header.doc_no).toBe("ITR-042");
    expect(stored?.status).toBe("draft");
    expect(stored?.serial_no).toBeNull();

    // --- Reload --- a fresh mount on the same store resumes the draft.
    first.unmount();
    render(
      <RecordForm
        template={template}
        repo={repo}
        signaturesRepo={signaturesRepo}
        auditRepo={auditRepo}
        registryRepo={registryRepo}
        role="site_engineer"
        sync={sync}
      />,
    );
    expect(await screen.findByLabelText("Doc No")).toHaveValue("ITR-042");
  });

  it("autosaves edits without an explicit save", async () => {
    const user = userEvent.setup();
    const { repo, signaturesRepo, auditRepo, registryRepo } = freshRepos();

    render(
      <RecordForm
        template={template}
        repo={repo}
        signaturesRepo={signaturesRepo}
        auditRepo={auditRepo}
        registryRepo={registryRepo}
        role="site_engineer"
        sync={new PassthroughSync()}
        autosaveMs={0}
      />,
    );
    const docNo = await screen.findByLabelText("Doc No");
    await user.type(docNo, "AUTO-1");

    // Autosave is eventually consistent; wait for the final value to land.
    await waitFor(async () => {
      const stored = await repo.latestDraft(templateVersionId(template));
      expect(stored?.values.header.doc_no).toBe("AUTO-1");
    });
  });

  it("warns and reloads the server copy when a push is refused as a conflict (§8)", async () => {
    const user = userEvent.setup();
    const { repo, signaturesRepo, auditRepo, registryRepo } = freshRepos();

    // The server holds a locked version; the client's push is refused, and pull
    // returns that server copy to reconcile to.
    const serverValues = emptyValues(template);
    serverValues.header.doc_no = "SERVER-COPY";
    const serverRecord = {
      ...createDraft(template, {
        id: uuidv7(),
        now: "2026-08-02T00:00:00.000Z",
        createdBy: "u",
      }),
      status: "rejected" as const,
      values: serverValues,
    };
    const sync: SyncLayer = {
      push: vi.fn().mockResolvedValue({ conflict: true }),
      pull: vi.fn().mockResolvedValue(serverRecord),
      pushSignature: vi.fn().mockResolvedValue(undefined),
      pushAudit: vi.fn().mockResolvedValue(undefined),
    };

    render(
      <RecordForm
        template={template}
        repo={repo}
        signaturesRepo={signaturesRepo}
        auditRepo={auditRepo}
        registryRepo={registryRepo}
        role="site_engineer"
        sync={sync}
        autosaveMs={0}
      />,
    );
    const docNo = await screen.findByLabelText("Doc No");
    await user.type(docNo, "LOCAL-EDIT");

    // The conflict warning surfaces, the server copy is pulled, and the form
    // reconciles to the server's locked (rejected) state instead of keeping the
    // refused local edit.
    expect(await screen.findByText(/locked on the server/i)).toBeInTheDocument();
    expect(sync.pull).toHaveBeenCalled();
    expect(
      await screen.findByText(/Fields locked — record is rejected/i),
    ).toBeInTheDocument();
  });

  it("creates exactly one draft for a template on first load", async () => {
    const { repo, signaturesRepo, auditRepo, registryRepo } = freshRepos();
    render(
      <RecordForm
        template={template}
        repo={repo}
        signaturesRepo={signaturesRepo}
        auditRepo={auditRepo}
        registryRepo={registryRepo}
        role="site_engineer"
        sync={new PassthroughSync()}
      />,
    );
    await screen.findByLabelText("Doc No");
    expect(await repo.list()).toHaveLength(1);
  });
});
