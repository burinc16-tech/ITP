import { describe, it, expect, beforeAll, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseTemplate } from "@schema";
import rawTemplate from "../../../spec/templates/heat-load-test.json";
import { createAuditEntry } from "../data/audit";
import { AuditRepo } from "../data/audit-repo";
import { ChecklistDb } from "../data/db";
import { createDraft, templateVersionId } from "../data/record";
import { RecordsRepo } from "../data/records-repo";
import { RegistryRepo } from "../data/registry-repo";
import { createSignature } from "../data/signature";
import { SignaturesRepo } from "../data/signatures-repo";
import { PassthroughSync } from "../data/sync";
import { uuidv7 } from "../data/uuidv7";
import { RecordForm } from "./record-form";

const template = parseTemplate(rawTemplate);

// jsdom has no object-URL support; the form only needs a stable string back.
beforeAll(() => {
  URL.createObjectURL = vi.fn(() => "blob:test");
  URL.revokeObjectURL = vi.fn();
});

/** A resumable draft with required fields filled and the contractor signed. */
async function seedSignedDraft() {
  const db = new ChecklistDb(`test-${uuidv7()}`);
  const repo = new RecordsRepo(db);
  const signaturesRepo = new SignaturesRepo(db);
  const auditRepo = new AuditRepo(db);
  const registryRepo = new RegistryRepo(db);

  const id = uuidv7();
  const now = "2026-08-02T00:00:00.000Z";
  const rec = createDraft(template, { id, now, createdBy: "u" });
  rec.values.header.doc_no = "ITR-1";
  rec.values.header.inspector = "A. Engineer";
  rec.values.header.insp_date = "2026-08-02";
  await repo.upsert(rec);
  await signaturesRepo.add(
    createSignature({
      id: uuidv7(),
      recordId: id,
      slotId: "sig_tested",
      role: "Inspection / Tested by",
      name: "A. Engineer",
      company: "Kenyon Pte Ltd",
      image: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
      signedByUser: "u",
      deviceId: "device-1",
      now,
    }),
  );
  return { id, repo, signaturesRepo, auditRepo, registryRepo };
}

describe("RecordForm — status workflow", () => {
  it("completes a signed, filled draft, locks fields, and logs the transition", async () => {
    const user = userEvent.setup();
    const { id, repo, signaturesRepo, auditRepo, registryRepo } = await seedSignedDraft();

    render(
      <RecordForm
        template={template}
        repo={repo}
        signaturesRepo={signaturesRepo}
        auditRepo={auditRepo}
        registryRepo={registryRepo}
        sync={new PassthroughSync()}
        role="site_engineer"
      />,
    );

    const complete = await screen.findByRole("button", { name: "Mark complete" });
    // The button enables once the seeded signature has loaded.
    await waitFor(() => expect(complete).toBeEnabled());

    await user.click(complete);

    // Status advanced and the fields are now locked.
    expect(await screen.findByText(/Fields locked/)).toBeInTheDocument();
    const stored = await repo.get(id);
    expect(stored?.status).toBe("completed");
    expect(stored?.completed_at).not.toBeNull();
    expect(stored?.context_snapshot).not.toBeNull();

    // The transition is in the audit log.
    const log = await auditRepo.listByRecord(id);
    expect(log).toHaveLength(1);
    expect(log[0]!.action).toBe("complete");
    expect(log[0]!.before).toBe("draft");
    expect(log[0]!.after).toBe("completed");
    expect(log[0]!.role).toBe("site_engineer");
  });

  it("blocks completion when the contractor signature is missing", async () => {
    const db = new ChecklistDb(`test-${uuidv7()}`);
    const repo = new RecordsRepo(db);
    const id = uuidv7();
    const rec = createDraft(template, { id, now: "2026-08-02T00:00:00.000Z", createdBy: "u" });
    rec.values.header.doc_no = "ITR-2";
    rec.values.header.inspector = "A";
    rec.values.header.insp_date = "2026-08-02";
    await repo.upsert(rec);

    render(
      <RecordForm
        template={template}
        repo={repo}
        signaturesRepo={new SignaturesRepo(db)}
        auditRepo={new AuditRepo(db)}
        registryRepo={new RegistryRepo(db)}
        sync={new PassthroughSync()}
        role="site_engineer"
      />,
    );

    const complete = await screen.findByRole("button", { name: "Mark complete" });
    expect(complete).toBeDisabled();
    expect(screen.getByText(/Tested By signature/)).toBeInTheDocument();
  });
});

describe("RecordForm — reject and revise (§6)", () => {
  it("rejects a completed record, then revises it into an editable Rev 2", async () => {
    const user = userEvent.setup();
    const { id, repo, signaturesRepo, auditRepo, registryRepo } = await seedSignedDraft();
    const sync = new PassthroughSync();
    const shared = { template, repo, signaturesRepo, auditRepo, registryRepo, sync };

    const { rerender } = render(<RecordForm {...shared} role="site_engineer" />);

    const complete = await screen.findByRole("button", { name: "Mark complete" });
    await waitFor(() => expect(complete).toBeEnabled());
    await user.click(complete);
    await screen.findByText(/Fields locked/);

    // QA/QC rejects with a reason.
    rerender(<RecordForm {...shared} role="qa_qc" />);
    await user.click(await screen.findByRole("button", { name: "Reject" }));
    await user.type(
      screen.getByLabelText(/Reason for rejection/),
      "Ambient temperature out of range",
    );
    await user.click(screen.getByRole("button", { name: "Confirm rejection" }));

    // The rejection and its reason are shown.
    expect(await screen.findByText(/Ambient temperature out of range/)).toBeInTheDocument();

    // Revise into the next revision.
    await user.click(await screen.findByRole("button", { name: /Revise/ }));

    expect(await screen.findByText("Rev 2")).toBeInTheDocument();
    // Fields are editable again on the fresh draft.
    expect(await screen.findByRole("button", { name: "Save record" })).toBeInTheDocument();

    // The next rev supersedes the rejected one, which is left untouched.
    const rev2 = await repo.bySupersedes(id);
    expect(rev2?.rev).toBe(2);
    expect(rev2?.status).toBe("draft");
    expect(rev2?.values.header.doc_no).toBe("ITR-1");
    const prev = await repo.get(id);
    expect(prev?.status).toBe("rejected");
    expect(prev?.rev).toBe(1);

    const revLog = await auditRepo.listByRecord(rev2!.id);
    expect(revLog.some((e) => e.action === "revised_from")).toBe(true);
  });

  it("resumes onto a still-open rejected record instead of a blank draft", async () => {
    const db = new ChecklistDb(`test-${uuidv7()}`);
    const repo = new RecordsRepo(db);
    const auditRepo = new AuditRepo(db);
    const id = uuidv7();
    const rec = {
      ...createDraft(template, { id, now: "2026-08-02T00:00:00.000Z", createdBy: "u" }),
      status: "rejected" as const,
    };
    await repo.upsert(rec);
    await auditRepo.add(
      createAuditEntry({
        id: uuidv7(),
        recordId: id,
        user: "u",
        role: "qa_qc",
        action: "reject",
        before: "witnessed",
        after: "rejected",
        reason: "Missing readings",
        now: "2026-08-02T01:00:00.000Z",
      }),
    );

    render(
      <RecordForm
        template={template}
        repo={repo}
        signaturesRepo={new SignaturesRepo(db)}
        auditRepo={auditRepo}
        registryRepo={new RegistryRepo(db)}
        sync={new PassthroughSync()}
        role="site_engineer"
      />,
    );

    // It resumed the rejected record (reason + Revise shown), not a new draft.
    expect(await screen.findByText(/Missing readings/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Revise/ })).toBeInTheDocument();
    expect(await repo.latestDraft(templateVersionId(template))).toBeUndefined();
  });
});
