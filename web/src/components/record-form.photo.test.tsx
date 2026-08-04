import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseTemplate } from "@schema";
import rawTemplate from "../../../spec/templates/heat-load-test.json";
import { AttachmentsRepo } from "../data/attachments-repo";
import { AuditRepo } from "../data/audit-repo";
import { ChecklistDb } from "../data/db";
import { createDraft } from "../data/record";
import { RecordsRepo } from "../data/records-repo";
import { RegistryRepo } from "../data/registry-repo";
import { SignaturesRepo } from "../data/signatures-repo";
import { PassthroughSync } from "../data/sync";
import { uuidv7 } from "../data/uuidv7";
import { RecordForm } from "./record-form";

// The shipped templates declare no photo fields yet (IDF Handover, which does,
// isn't converted). Inject a photo row so the capture path can be exercised.
const withPhoto = structuredClone(rawTemplate) as typeof rawTemplate & {
  sections: unknown[];
};
withPhoto.sections.push({
  id: "photos",
  title: "Photographic Record",
  rows: [{ id: "ph_01", description: "Load bank setup", type: "photo" }],
});
const template = parseTemplate(withPhoto);

describe("RecordForm — photo capture (§8)", () => {
  it("captures a photo, shows a thumbnail, and stores it against the field", async () => {
    const user = userEvent.setup();
    const db = new ChecklistDb(`test-${uuidv7()}`);
    const repo = new RecordsRepo(db);
    const attachmentsRepo = new AttachmentsRepo(db);
    const id = uuidv7();
    await repo.upsert(createDraft(template, { id, now: "2026-08-04T00:00:00.000Z", createdBy: "u" }));

    render(
      <RecordForm
        template={template}
        recordId={id}
        repo={repo}
        signaturesRepo={new SignaturesRepo(db)}
        auditRepo={new AuditRepo(db)}
        registryRepo={new RegistryRepo(db)}
        attachmentsRepo={attachmentsRepo}
        role="site_engineer"
        sync={new PassthroughSync()}
        autosaveMs={5000}
      />,
    );

    const input = await screen.findByLabelText("Photos — ph_01");
    const file = new File([new Uint8Array([1, 2, 3])], "loadbank.jpg", { type: "image/jpeg" });
    await user.upload(input, file);

    // Thumbnail appears on screen…
    expect(await screen.findByAltText("Photos — ph_01")).toBeInTheDocument();
    // …and the blob is persisted against that field.
    await waitFor(async () => {
      const rows = await attachmentsRepo.listByRecord(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.field_id).toBe("ph_01");
    });
  });

  it("backfills a photo captured on another device when the record opens (§8)", async () => {
    const db = new ChecklistDb(`test-${uuidv7()}`);
    const repo = new RecordsRepo(db);
    const attachmentsRepo = new AttachmentsRepo(db);
    const id = uuidv7();
    await repo.upsert(createDraft(template, { id, now: "2026-08-04T00:00:00.000Z", createdBy: "u" }));

    // A sync layer that reports a server photo this device doesn't hold locally.
    class BackfillSync extends PassthroughSync {
      async pullAttachments() {
        return [{ id: "srv1", field_id: "ph_01", caption: "from other device", device_id: "d2", created_at: "2026-08-04T01:00:00.000Z" }];
      }
      async pullAttachmentImage() {
        return new Blob([new Uint8Array([9, 9, 9])], { type: "image/jpeg" });
      }
    }

    render(
      <RecordForm
        template={template}
        recordId={id}
        repo={repo}
        signaturesRepo={new SignaturesRepo(db)}
        auditRepo={new AuditRepo(db)}
        registryRepo={new RegistryRepo(db)}
        attachmentsRepo={attachmentsRepo}
        role="site_engineer"
        sync={new BackfillSync()}
        autosaveMs={5000}
      />,
    );

    // The server photo shows (on-screen thumbnail + printed evidence)…
    expect((await screen.findAllByAltText("from other device")).length).toBeGreaterThan(0);
    // …and is now stored locally, so it's available offline afterwards.
    await waitFor(async () => {
      const rows = await attachmentsRepo.listByRecord(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).toBe("srv1");
    });
  });
});
