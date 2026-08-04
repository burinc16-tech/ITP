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
});
