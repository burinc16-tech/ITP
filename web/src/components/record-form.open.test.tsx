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

/**
 * A signature is captured into the signing device's own store and pushed up, so
 * without a pull on open it stays on that device: the slot reads blank on the
 * laptop and the record prints DRAFT even though the tablet already signed it.
 */
describe("RecordForm — signature backfill on open (§8)", () => {
  /** A sync layer reporting one signature this device never captured. */
  class BackfillSync extends PassthroughSync {
    async pullSignatures() {
      return [
        {
          id: "srv-sig-1",
          slot_id: "sig_tested",
          role: "Inspection / Tested by",
          name: "T. Tablet",
          company: "Kenyon Pte Ltd",
          method: "remote_link" as const,
          signed_by_user: "u2",
          device_id: "tablet-1",
          signed_at: "2026-08-02T02:00:00.000Z",
        },
      ];
    }
    async pullSignatureImage() {
      return new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    }
  }

  /** Reports the same signature but can't produce its image (offline mid-pull). */
  class ImagelessSync extends BackfillSync {
    async pullSignatureImage() {
      return null as unknown as Blob;
    }
  }

  async function openWith(sync: PassthroughSync) {
    const db = new ChecklistDb(`test-${uuidv7()}`);
    const h = harness(db);
    const id = uuidv7();
    await h.repo.upsert(
      createDraft(template, { id, now: "2026-08-02T00:00:00.000Z", createdBy: "u" }),
    );
    const view = render(
      <RecordForm
        recordId={id}
        template={template}
        repo={h.repo}
        signaturesRepo={h.signaturesRepo}
        auditRepo={h.auditRepo}
        registryRepo={h.registryRepo}
        sync={sync}
        role="site_engineer"
        onBack={vi.fn()}
      />,
    );
    return { ...h, id, ...view };
  }

  it("shows a signature captured on another device", async () => {
    await openWith(new BackfillSync());

    expect(
      await screen.findByAltText("Inspection / Tested by signature"),
    ).toBeInTheDocument();
    // On screen and on the printed sheet — the signer's name appears in both.
    expect(screen.getAllByText("T. Tablet").length).toBeGreaterThan(0);
  });

  it("stores it locally, so it survives going offline", async () => {
    const { signaturesRepo, id } = await openWith(new BackfillSync());
    await screen.findByAltText("Inspection / Tested by signature");

    const rows = await signaturesRepo.listByRecord(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe("srv-sig-1");
    // The evidence lands as the server holds it — including the signing device
    // and method — not re-stamped as this device's own on-device signature.
    expect(rows[0]!.device_id).toBe("tablet-1");
    expect(rows[0]!.method).toBe("remote_link");
    expect(rows[0]!.signed_at).toBe("2026-08-02T02:00:00.000Z");
  });

  it("drops the DRAFT watermark once the pulled signature lands", async () => {
    const { container } = await openWith(new BackfillSync());
    await screen.findByAltText("Inspection / Tested by signature");

    expect(container.querySelectorAll(".print-watermark")).toHaveLength(0);
  });

  it("stays unsigned when the image can't be fetched", async () => {
    const { signaturesRepo, id, container } = await openWith(new ImagelessSync());
    // The record still opens; metadata alone is not evidence, so nothing is stored.
    await screen.findByLabelText("Doc No");

    expect(await signaturesRepo.listByRecord(id)).toHaveLength(0);
    expect(container.querySelectorAll(".print-watermark").length).toBeGreaterThan(0);
  });

  it("shows nothing extra in local-only mode", async () => {
    const { signaturesRepo, id } = await openWith(new PassthroughSync());
    await screen.findByLabelText("Doc No");

    expect(await signaturesRepo.listByRecord(id)).toHaveLength(0);
  });
});
